import Database from 'better-sqlite3'
import { and, count, eq, sql as drizzleSql } from 'drizzle-orm'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PostgreSQLBackend } from './backends/postgres'
import { DrizzleRepository } from './repository'
import { databasePath } from './paths'
import { createDatabase, rawDatabase } from './connection'
import type { AccountRole, PrinterProfile, WorkspaceRole } from '../core/types'
import { account, assetGenerationJobs, requests, requestStatuses, session, subscription, uploadSessions, user } from './schema'

async function insertUser(
  repository: DrizzleRepository,
  values: { id: string; name: string; email: string; accountRole?: AccountRole; workspaceRole?: WorkspaceRole; color?: string },
) {
  const now = new Date()
  await repository.database
    .insert(user)
    .values({ ...values, role: values.accountRole ?? 'requester', emailVerified: true, createdAt: now, updatedAt: now })
    .run()
  await repository.addWorkspaceMember(values.id, values.workspaceRole ?? 'member')
}

const contractBackends = process.env.POSTGRES_TEST_URL ? (['sqlite', 'postgres'] as const) : (['sqlite'] as const)

describe.each(contractBackends)('DrizzleRepository contract (%s)', (backend) => {
  let repository: DrizzleRepository

  beforeAll(async () => {
    if (backend !== 'postgres') return
    const url = process.env.POSTGRES_TEST_URL!
    if (!new URL(url).pathname.endsWith('_test')) throw new Error('POSTGRES_TEST_URL must name a database ending in _test')
    const client = postgres(url, { max: 1 })
    await client`DROP SCHEMA public CASCADE`
    await client`DROP SCHEMA IF EXISTS drizzle CASCADE`
    await client`CREATE SCHEMA public`
    await client.end()
  })

  beforeEach(async () => {
    repository =
      backend === 'postgres'
        ? await DrizzleRepository.create(PostgreSQLBackend.open(process.env.POSTGRES_TEST_URL!))
        : await DrizzleRepository.create(createDatabase(':memory:'))
    await insertUser(repository, { id: 'maker', name: 'Maker', email: 'maker@example.com' })
    await insertUser(repository, { id: 'other', name: 'Other', email: 'other@example.com' })
    await insertUser(repository, { id: 'owner', name: 'Owner', email: 'owner@example.com' })
    await insertUser(repository, { id: 'attacker', name: 'Attacker', email: 'attacker@example.com' })
  })
  afterEach(async () => {
    await repository.close()
    if (backend === 'postgres') await truncatePostgreSQL(process.env.POSTGRES_TEST_URL!)
  })

  afterAll(async () => {
    if (backend === 'postgres') await resetPostgreSQL(process.env.POSTGRES_TEST_URL!)
  })

  async function reopenRepository() {
    return backend === 'postgres'
      ? await DrizzleRepository.create(PostgreSQLBackend.open(process.env.POSTGRES_TEST_URL!))
      : await DrizzleRepository.create(repository.database, { ownsDatabase: false })
  }

  it('checks whether the workspace has requests', async () => {
    expect(await repository.hasRequests()).toBe(false)
    await repository.createRequest({
      name: 'Model',
      fileName: 'model.stl',
      filePath: 'todo/model.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    expect(await repository.hasRequests()).toBe(true)
  })

  it('persists requests and tracks copy quantities transactionally', async () => {
    const id = await repository.createRequest({
      name: 'Bracket',
      fileName: 'bracket.stl',
      filePath: 'todo/bracket.stl',
      quantity: 3,
      ownerUserId: 'maker',
      notes: 'PETG',
      sourceUrl: 'https://example.com/bracket',
      printerId: 'printer-id',
    })
    expect(await repository.getRequest(id)).toMatchObject({
      counts: { todo: 3, up_next: 0, in_progress: 0, done: 0 },
      sourceUrl: 'https://example.com/bracket',
      requestedPrintType: undefined,
      printerId: 'printer-id',
    })

    await repository.updateRequest(id, { printerId: 'next-printer' })
    expect(await repository.getRequest(id)).toMatchObject({ printerId: 'next-printer' })

    await repository.moveCopies({ id, from: 'todo', to: 'in_progress', count: 2, filePath: 'todo/bracket.stl', order: 4 })
    expect(await repository.getRequest(id)).toMatchObject({
      counts: { todo: 1, in_progress: 2, done: 0 },
      orders: { in_progress: undefined },
    })
    await expect(repository.moveCopies({ id, from: 'todo', to: 'done', count: 2, filePath: 'todo/bracket.stl' })).rejects.toThrow(
      'invalid move',
    )
    expect((await repository.getRequest(id))?.counts).toEqual({ todo: 1, up_next: 0, in_progress: 2, post_processing: 0, done: 0 })
  })

  it('compare-and-swaps a request asset path', async () => {
    const id = await repository.createRequest({
      name: 'Bracket',
      fileName: 'bracket.stl',
      filePath: 'todo/bracket.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })

    expect(await repository.updateRequestFilePath(id, 'done/bracket.stl', 'models/bracket.stl')).toBe(false)
    expect(await repository.updateRequestFilePath(id, 'todo/bracket.stl', 'models/bracket.stl')).toBe(true)
    expect((await repository.getRequest(id))?.filePath).toBe('models/bracket.stl')
  })

  it('tracks thumbnail and preview generation as durable stages', async () => {
    const id = await repository.createRequest({
      name: 'Stages',
      fileName: 'stages.stl',
      filePath: 'todo/stages.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    expect(await repository.assetGenerationJobs(id)).toEqual([
      expect.objectContaining({ stage: 'preview', status: 'pending' }),
      expect.objectContaining({ stage: 'thumbnail', status: 'pending' }),
    ])
    await repository.startAssetGeneration(id, ['thumbnail', 'preview'])
    await repository.finishAssetGeneration(id, 'thumbnail', { status: 'ready', path: 'thumbnails/stages.png' })
    await repository.finishAssetGeneration(id, 'preview', { status: 'skipped' })
    expect(await repository.assetGenerationJobs(id)).toEqual([
      expect.objectContaining({ stage: 'preview', status: 'skipped' }),
      expect.objectContaining({ stage: 'thumbnail', status: 'ready' }),
    ])
    expect(await repository.requestsNeedingAssets()).toEqual([])
  })

  it('pages asset generation candidates by request id', async () => {
    const ids = await Promise.all(
      ['One', 'Two', 'Three'].map(
        async (name) =>
          await repository.createRequest({
            name,
            fileName: `${name}.stl`,
            filePath: `todo/${name}.stl`,
            quantity: 1,
            ownerUserId: 'maker',
          }),
      ),
    )
    const ordered = [...ids].sort()
    const first = await repository.assetGenerationCandidates(undefined, 2)
    const second = await repository.assetGenerationCandidates(first.at(-1), 2)

    expect([...first, ...second]).toEqual(ordered)
  })

  it.skipIf(backend === 'postgres')('requeues existing previews through the compressed preview migration', async () => {
    const id = await repository.createRequest({
      name: 'Quantized preview',
      fileName: 'quantized.stl',
      filePath: 'todo/quantized.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    await repository.startAssetGeneration(id, ['thumbnail', 'preview'])
    await repository.finishAssetGeneration(id, 'thumbnail', { status: 'ready', path: 'thumbnails/quantized.png' })
    await repository.finishAssetGeneration(id, 'preview', { status: 'ready', path: 'previews/quantized.phm' })
    const migration = fs
      .readFileSync(path.resolve('drizzle/0004_regenerate_compressed_previews.sql'), 'utf8')
      .replaceAll('--> statement-breakpoint', '')
    rawDatabase(repository.database).$client.exec(migration)
    expect(await repository.assetGenerationJobs(id)).toContainEqual(expect.objectContaining({ stage: 'preview', status: 'pending' }))
    expect(await repository.requestsNeedingAssets()).toEqual([id])
  })

  it('queries request metadata, ranges, statuses, facets, and whitelisted sorting', async () => {
    const bracket = await repository.createRequest({
      name: 'Bracket',
      fileName: 'secret-bracket.stl',
      filePath: 'todo/bracket.stl',
      quantity: 3,
      ownerUserId: 'maker',
      notes: 'Use orange PETG',
      sourceUrl: 'https://example.com/bracket',
      thumbnailPath: 'thumbs/bracket.png',
      previewPath: 'previews/bracket.stl',
    })
    const gear = await repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 1,
      ownerUserId: 'other',
    })
    await repository.moveCopies({ id: bracket, from: 'todo', to: 'in_progress', count: 1, filePath: 'todo/bracket.stl' })
    await repository.database.update(requests).set({ createdAt: 100, updatedAt: 300 }).where(eq(requests.id, bracket)).run()
    await repository.database.update(requests).set({ createdAt: 200, updatedAt: 200 }).where(eq(requests.id, gear)).run()

    expect(
      (
        await repository.queryRequests({
          filters: { query: 'orange', hasNotes: true, hasSource: true, hasThumbnail: true, hasPreview: true },
        })
      ).requests,
    ).toMatchObject([{ id: bracket }])
    expect((await repository.queryRequests({ filters: { requester: 'maker', minQuantity: 2, maxQuantity: 4 } })).requests).toMatchObject([
      { id: bracket },
    ])
    expect((await repository.queryRequests({ filters: { createdAfter: 150, updatedBefore: 250 } })).requests).toMatchObject([{ id: gear }])
    expect(
      (await repository.queryRequests({ filters: { hasNotes: false, hasSource: false, hasThumbnail: false, hasPreview: false } })).requests,
    ).toMatchObject([{ id: gear }])
    expect((await repository.queryRequests({ filters: { sort: 'name-desc' } })).requests.map((request) => request.name)).toEqual([
      'Gear',
      'Bracket',
    ])
    expect((await repository.queryRequests({ filters: { sort: 'quantity-desc' } })).requests.map((request) => request.quantity)).toEqual([
      3, 1,
    ])

    const result = await repository.queryRequests({ filters: { requester: 'maker' } })
    expect(result.facets).toMatchObject({ total: 1, available: 2 })
    expect(result.facets.requesters).toEqual([
      { value: 'maker', label: 'Maker', count: 1 },
      { value: 'other', label: 'Other', count: 1 },
    ])
  })

  it('keeps requesters with duplicate display names distinct', async () => {
    await insertUser(repository, { id: 'alex-1', name: 'Alex', email: 'alex-1@example.com' })
    await insertUser(repository, { id: 'alex-2', name: 'Alex', email: 'alex-2@example.com' })
    for (const ownerUserId of ['alex-1', 'alex-2']) {
      await repository.createRequest({
        name: ownerUserId,
        fileName: `${ownerUserId}.stl`,
        filePath: `todo/${ownerUserId}.stl`,
        quantity: 1,
        ownerUserId,
      })
    }

    expect((await repository.queryRequests()).facets.requesters.filter(({ label }) => label === 'Alex')).toEqual([
      { value: 'alex-1', label: 'Alex', count: 1 },
      { value: 'alex-2', label: 'Alex', count: 1 },
    ])
    expect((await repository.queryRequests({ filters: { requester: 'alex-2' } })).requests.map(({ ownerUserId }) => ownerUserId)).toEqual([
      'alex-2',
    ])
  })

  it('filters mixed requests by print type and printer assignment', async () => {
    const resin = await repository.createRequest({
      name: 'Resin model',
      fileName: 'resin.stl',
      filePath: 'todo/resin.stl',
      quantity: 1,
      ownerUserId: 'maker',
      printerId: 'resin-printer',
    })
    const filament = await repository.createRequest({
      name: 'Filament model',
      fileName: 'filament.stl',
      filePath: 'todo/filament.stl',
      quantity: 1,
      ownerUserId: 'maker',
      printerId: 'filament-printer',
    })
    const unassigned = await repository.createRequest({
      name: 'Unassigned filament model',
      fileName: 'unassigned.stl',
      filePath: 'todo/unassigned.stl',
      quantity: 1,
      ownerUserId: 'maker',
      requestedPrintType: 'filament',
    })

    await repository.setSetting('printers', [
      {
        id: 'resin-printer',
        name: 'Resin printer',
        printType: 'resin',
        widthMm: 100,
        depthMm: 60,
        heightMm: 150,
        spacingMm: 2,
        supportMarginMm: 2,
        adhesionMarginMm: 1,
        heightAllowanceMm: 4,
        maxHeightDifferenceMm: 20,
      },
      {
        id: 'filament-printer',
        name: 'Filament printer',
        printType: 'filament',
        widthMm: 220,
        depthMm: 220,
        heightMm: 250,
        spacingMm: 3,
        brimMarginMm: 2,
        filamentDiameterMm: 1.75,
        materialDensityGPerCm3: 1.24,
      },
    ])

    expect((await repository.queryRequests({ filters: { printType: 'filament' } })).requests.map(({ id }) => id).sort()).toEqual(
      [unassigned, filament].sort(),
    )
    expect((await repository.queryRequests({ filters: { printerId: 'resin-printer' } })).requests.map(({ id }) => id)).toEqual([resin])
    expect((await repository.queryRequests({ filters: { printerId: null } })).requests.map(({ id }) => id)).toEqual([unassigned])
  })

  it('applies visibility and ownership before returning requests or facets', async () => {
    await insertUser(repository, { id: 'me', name: 'Me', email: 'me@example.com' })
    await insertUser(repository, { id: 'them', name: 'Them', email: 'them@example.com' })
    await repository.createRequest({
      name: 'Mine',
      fileName: 'mine.stl',
      filePath: 'todo/mine.stl',
      quantity: 1,
      ownerUserId: 'me',
    })
    await repository.createRequest({
      name: 'Theirs',
      fileName: 'theirs.stl',
      filePath: 'todo/theirs.stl',
      quantity: 1,
      ownerUserId: 'them',
    })
    const privateResult = await repository.queryRequests({ visibleToUserId: 'me' })
    expect(privateResult.requests.map((request) => request.name)).toEqual(['Mine'])
    expect(privateResult.facets).toMatchObject({ total: 1, available: 1 })
    expect((await repository.queryRequests({ ownerUserId: 'me' })).requests.map((request) => request.name)).toEqual(['Mine'])

    await repository.database.update(user).set({ name: 'Renamed' }).where(eq(user.id, 'me')).run()
    expect((await repository.queryRequests({ ownerUserId: 'me' })).requests[0]).toMatchObject({ ownerName: 'Renamed' })

    await expect(repository.database.delete(user).where(eq(user.id, 'me')).run()).rejects.toThrow()
    expect((await repository.listRequests()).find((request) => request.name === 'Mine')).toMatchObject({
      ownerUserId: 'me',
      ownerName: 'Renamed',
    })
  })

  it('only searches private file and email metadata when enabled', async () => {
    await repository.createRequest({
      name: 'Model',
      fileName: 'private-file.stl',
      filePath: 'todo/model.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    expect((await repository.queryRequests({ filters: { query: 'private-file' } })).requests).toHaveLength(0)
    expect(
      (await repository.queryRequests({ filters: { query: 'maker@example.com' }, searchPrivateMetadata: true })).requests,
    ).toHaveLength(1)
  })

  it('enforces quantity invariants and cascades status deletion', async () => {
    const id = await repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 2,
      ownerUserId: 'maker',
    })
    await repository.moveCopies({ id, from: 'todo', to: 'done', count: 1, filePath: 'todo/gear.stl' })
    // Shrinking below the started-copies count is a client-visible 409, not a 500 — the wrapper only
    // treats thrown Responses as handled failures, so a plain Error would escape as a fault.
    await expect(repository.updateRequest(id, { quantity: 0 })).rejects.toThrow(expect.objectContaining({ status: 409 }))
    await repository.updateRequest(id, { quantity: 4, notes: 'four please', sourceUrl: 'https://example.com/gear' })
    expect(await repository.getRequest(id)).toMatchObject({
      quantity: 4,
      counts: { todo: 3, done: 1 },
      notes: 'four please',
      sourceUrl: 'https://example.com/gear',
    })
    await repository.deleteRequest(id)
    expect(await repository.getRequest(id)).toBeUndefined()
  })

  it('rejects shrinking a request below its started copies with a 409', async () => {
    const id = await repository.createRequest({
      name: 'Bracket',
      fileName: 'bracket.stl',
      filePath: 'todo/bracket.stl',
      quantity: 5,
      ownerUserId: 'maker',
    })
    await repository.moveCopies({ id, from: 'todo', to: 'done', count: 3, filePath: 'todo/bracket.stl' })
    await expect(repository.updateRequest(id, { quantity: 2 })).rejects.toThrow(expect.objectContaining({ status: 409 }))
    // The guard leaves the request untouched and still allows shrinking down to the started count.
    expect(await repository.getRequest(id)).toMatchObject({ quantity: 5, counts: { todo: 2, done: 3 } })
    await repository.updateRequest(id, { quantity: 3 })
    expect(await repository.getRequest(id)).toMatchObject({ quantity: 3, counts: { todo: 0, done: 3 } })
  })

  it('cascades completed upload receipts when deleting their request', async () => {
    const id = await repository.createRequest({
      name: 'Uploaded gear',
      fileName: 'uploaded-gear.stl',
      filePath: 'todo/uploaded-gear.stl',
      quantity: 1,
      ownerUserId: 'owner',
    })
    await repository.createUploadSession('completed-upload', 'owner', Date.now() + 60_000, 3)
    await repository.database.update(uploadSessions).set({ completedRequestId: id }).where(eq(uploadSessions.id, 'completed-upload')).run()

    await repository.deleteRequest(id)

    expect(await repository.database.select().from(uploadSessions).where(eq(uploadSessions.id, 'completed-upload')).get()).toBeUndefined()
  })

  it('round-trips JSON settings by key', async () => {
    expect(await repository.getSetting('storage')).toBeUndefined()
    await repository.setSetting('storage', { adapter: 'local', root: '/prints' })
    expect(await repository.getSetting('storage')).toEqual({ adapter: 'local', root: '/prints' })
    await repository.setSetting('storage', { adapter: 's3', bucket: 'prints' })
    expect(await repository.getSetting('storage')).toEqual({ adapter: 's3', bucket: 'prints' })
  })

  it('starts users with no onboarding progress', async () => {
    await expect(repository.getUserOnboarding('maker')).resolves.toEqual({ completedTasks: [], skippedTasks: [], celebratedTasks: [] })
  })

  it('persists onboarding progress per user', async () => {
    await repository.saveUserOnboarding('maker', {
      completedTasks: ['upload', 'filter'],
      skippedTasks: ['sort'],
      celebratedTasks: ['upload'],
    })

    await expect(repository.getUserOnboarding('maker')).resolves.toEqual({
      completedTasks: ['upload', 'filter'],
      skippedTasks: ['sort'],
      celebratedTasks: ['upload'],
    })
  })

  it('isolates workspace onboarding tasks while sharing learning progress', async () => {
    const firstWorkspace = (await repository.listWorkspacesForUser('maker'))[0]
    const secondWorkspace = await repository.createWorkspace({ id: 'maker' }, 'Second workspace')
    await repository.saveUserOnboarding(
      'maker',
      { completedTasks: ['upload', 'printers'], skippedTasks: ['storage'], celebratedTasks: ['upload', 'printers'] },
      firstWorkspace.id,
    )

    await expect(repository.getUserOnboarding('maker', firstWorkspace.id)).resolves.toEqual({
      completedTasks: ['upload', 'printers'],
      skippedTasks: ['storage'],
      celebratedTasks: ['upload', 'printers'],
    })
    await expect(repository.getUserOnboarding('maker', secondWorkspace.id)).resolves.toEqual({
      completedTasks: ['upload'],
      skippedTasks: [],
      celebratedTasks: ['upload'],
    })
  })

  it('updates and deletes settings in one transaction', async () => {
    await repository.setSetting('old-setting', { enabled: true })

    await repository.setSettings({ 'new-setting': { enabled: false } }, ['old-setting'])

    expect(await Promise.all([repository.getSetting('old-setting'), repository.getSetting('new-setting')])).toEqual([
      undefined,
      { enabled: false },
    ])
  })

  it('journals asset migrations per workspace', async () => {
    const primary = await repository.scoped('test-workspace')
    const secondaryWorkspace = await repository.createWorkspace({ id: 'owner' }, 'Second farm')
    const secondary = await repository.scoped(secondaryWorkspace.id)

    await primary.recordAssetMigration('0001_stable_model_paths')
    await primary.recordAssetMigration('0001_stable_model_paths')

    expect(await primary.listAssetMigrations()).toEqual(['0001_stable_model_paths'])
    expect(await secondary.listAssetMigrations()).toEqual([])
  })

  it.skipIf(backend === 'postgres')('maintains integrity, exposes database information, and installs the auth limiter table', async () => {
    const maintenance = await repository.maintain()
    expect(maintenance.integrity).toBe('ok')
    expect(maintenance.checkedAt).toBeGreaterThan(0)
    expect(await repository.databaseInfo()).toMatchObject({ location: { kind: 'local', path: ':memory:', sizeBytes: 0 }, integrity: 'ok' })
    expect((await repository.database.get<{ journal_mode: string }>(drizzleSql`PRAGMA journal_mode`))?.journal_mode).toBe('memory')
    expect((await repository.database.get<{ synchronous: number }>(drizzleSql`PRAGMA synchronous`))?.synchronous).toBe(2)
    expect((await repository.database.get<{ foreign_keys: number }>(drizzleSql`PRAGMA foreign_keys`))?.foreign_keys).toBe(1)
    expect((await repository.database.get<{ timeout: number }>(drizzleSql`PRAGMA busy_timeout`))?.timeout).toBe(5000)
    expect(await repository.database.get(drizzleSql`SELECT name FROM sqlite_master WHERE type='table' AND name='rateLimit'`)).toEqual({
      name: 'rateLimit',
    })
  })

  it.skipIf(backend === 'postgres')('creates a consistent online backup', async () => {
    const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-backup-'))
    const source = path.join(temporary, 'source.sqlite')
    const destination = path.join(temporary, 'backups', 'copy.sqlite')
    const persisted = await DrizzleRepository.open(source)
    try {
      await insertUser(persisted, { id: 'maker', name: 'Maker', email: 'maker@example.com' })
      const id = await persisted.createRequest({
        name: 'Backup probe',
        fileName: 'probe.stl',
        filePath: 'todo/probe.stl',
        quantity: 1,
        ownerUserId: 'maker',
      })
      await persisted.backup(destination)
      const copy = new Database(destination, { readonly: true })
      try {
        expect(copy.pragma('quick_check', { simple: true })).toBe('ok')
        expect(await copy.prepare('SELECT name FROM requests WHERE id=?').get(id)).toEqual({ name: 'Backup probe' })
      } finally {
        copy.close()
      }
      expect(await persisted.databaseInfo()).toMatchObject({ location: { kind: 'local', path: source }, integrity: 'ok' })
      const info = await persisted.databaseInfo()
      expect(info.location.kind === 'local' ? info.location.sizeBytes : 0).toBeGreaterThan(0)
      expect((await fs.promises.readdir(path.dirname(destination))).filter((file) => file.endsWith('.tmp'))).toEqual([])
    } finally {
      await persisted.close()
      await fs.promises.rm(temporary, { recursive: true, force: true })
    }
  })

  it('reads users and people from the better-auth user table', async () => {
    await repository.database.delete(user).run()
    await insertUser(repository, { id: 'u1', name: 'Maker', email: 'maker@example.com', color: '#fa0' })
    await insertUser(repository, { id: 'u2', name: 'Zed', email: 'zed@example.com', workspaceRole: 'admin' })
    expect(await repository.listUsers()).toEqual([
      { id: 'u2', email: 'zed@example.com', name: 'Zed', image: undefined, role: 'admin', workspaceRole: 'admin' },
      { id: 'u1', email: 'maker@example.com', name: 'Maker', image: undefined, role: 'requester', workspaceRole: 'member' },
    ])
    expect(await repository.listPeople()).toEqual([
      { id: 'u1', name: 'Maker', color: '#fa0' },
      { id: 'u2', name: 'Zed', color: undefined },
    ])
    expect(await repository.countUsers()).toBe(2)
  })

  it('lists accounts independently of workspace membership', async () => {
    await repository.database.delete(user).run()
    await insertUser(repository, { id: 'member', name: 'Workspace Member', email: 'member@example.com' })
    const now = new Date()
    await repository.database
      .insert(user)
      .values({
        id: 'super-admin',
        name: 'Super Admin',
        email: 'admin@example.com',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
        role: 'super_admin',
      })
      .run()
    const lastOnlineAt = new Date('2026-07-20T12:00:00.000Z')
    await repository.database
      .insert(session)
      .values([
        {
          id: 'member-session',
          token: 'member-token',
          userId: 'member',
          createdAt: lastOnlineAt,
          updatedAt: lastOnlineAt,
          expiresAt: new Date('2026-08-20T12:00:00.000Z'),
        },
        {
          id: 'impersonated-session',
          token: 'impersonated-token',
          userId: 'member',
          impersonatedBy: 'super-admin',
          createdAt: new Date('2026-07-21T12:00:00.000Z'),
          updatedAt: new Date('2026-07-21T12:00:00.000Z'),
          expiresAt: new Date('2026-08-21T12:00:00.000Z'),
        },
      ])
      .run()

    expect(await repository.listUsers()).toEqual([expect.objectContaining({ id: 'member', workspaceRole: 'member' })])
    expect(await repository.listAccounts()).toEqual([
      expect.objectContaining({
        id: 'super-admin',
        email: 'admin@example.com',
        name: 'Super Admin',
        image: undefined,
        role: 'super_admin',
        lastOnlineAt: undefined,
        workspaceCount: 0,
      }),
      expect.objectContaining({
        id: 'member',
        email: 'member@example.com',
        name: 'Workspace Member',
        image: undefined,
        role: 'requester',
        lastOnlineAt: lastOnlineAt.getTime(),
        workspaceCount: 1,
      }),
    ])
    expect(await repository.accountExists('ADMIN@EXAMPLE.COM')).toBe(true)
    expect(await repository.accountExists('missing@example.com')).toBe(false)
  })

  it('summarizes every workspace for super-admin visibility', async () => {
    const created = await repository.createWorkspace({ id: 'owner' }, 'Second farm')
    const workspace = await repository.scoped(created.id)
    const requestId = await workspace.createRequest({
      name: 'Batch',
      fileName: 'batch.stl',
      filePath: 'todo/batch.stl',
      quantity: 3,
      ownerUserId: 'owner',
    })
    await workspace.setSetting('storageEncrypted', { encrypted: true })
    await workspace.setSetting('printers', [
      { id: 'active', name: 'Active', printType: 'resin' },
      { id: 'archived', name: 'Archived', printType: 'filament', archived: true },
    ] satisfies PrinterProfile[])
    await repository.database
      .update(assetGenerationJobs)
      .set({ status: 'failed', error: 'preview failed' })
      .where(
        and(
          eq(assetGenerationJobs.workspaceId, created.id),
          eq(assetGenerationJobs.requestId, requestId),
          eq(assetGenerationJobs.stage, 'preview'),
        ),
      )
      .run()

    const result = (await repository.listAdminWorkspaces()).find((candidate) => candidate.id === created.id)

    expect(result).toMatchObject({
      id: created.id,
      name: 'Second farm',
      personal: false,
      owners: [{ id: 'owner', name: 'Owner', email: 'owner@example.com', image: undefined }],
      memberCount: 1,
      requestCount: 1,
      copyCount: 3,
      printerCount: 1,
      storageConfigured: true,
      activeJobCount: 1,
      failedJobCount: 1,
    })
    expect(result?.lastRequestAt).toEqual(expect.any(Number))
    expect(await repository.listAdminWorkspaces(created.id)).toEqual([expect.objectContaining({ id: created.id })])
  })

  it('provides safe account details for super admins', async () => {
    const now = new Date()
    await repository.database.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, 'owner')).run()
    await repository.database
      .insert(account)
      .values({
        id: 'owner-google',
        accountId: 'provider-account',
        providerId: 'google',
        userId: 'owner',
        createdAt: now,
        updatedAt: now,
      })
      .run()
    const created = await repository.createWorkspace({ id: 'owner' }, 'Managed farm')
    const workspace = await repository.scoped(created.id)
    expect(await workspace.claimManagedStorage('owner', 3)).toBe(true)
    await repository.database
      .insert(subscription)
      .values({ id: 'owner-plan', plan: 'supporter', referenceId: 'owner', status: 'active', createdAt: now, updatedAt: now })
      .run()

    expect(await repository.getAdminAccountDetails('owner')).toMatchObject({
      id: 'owner',
      emailVerified: true,
      twoFactorEnabled: true,
      authProviders: ['google'],
      workspaces: expect.arrayContaining([expect.objectContaining({ id: created.id, role: 'owner' })]),
      managedStorage: { plan: 'supporter', usedBytes: 0, quotaBytes: 25_000_000_000 },
      subscription: { status: 'active', cancelAtPeriodEnd: false },
    })
    expect(await repository.getAdminAccountDetails('missing')).toBeUndefined()
  })

  it('isolates workspace requests, printers, invites, uploads, and members', async () => {
    const primary = await repository.scoped('test-workspace')
    const secondaryWorkspace = await repository.createWorkspace({ id: 'owner' }, 'Second farm')
    const secondary = await repository.scoped(secondaryWorkspace.id)
    const primaryRequest = await primary.createRequest({
      name: 'Primary model',
      fileName: 'primary.stl',
      filePath: 'todo/primary.stl',
      quantity: 1,
      ownerUserId: 'owner',
    })
    const secondaryRequest = await secondary.createRequest({
      name: 'Secondary model',
      fileName: 'secondary.stl',
      filePath: 'todo/secondary.stl',
      quantity: 1,
      ownerUserId: 'owner',
    })
    await primary.setSetting('board', { privateRequests: true })
    await secondary.setSetting('board', { privateRequests: false })
    await primary.setSetting('printers', [{ id: 'primary-printer', name: 'Primary printer', printType: 'resin' }])
    await secondary.setSetting('printers', [{ id: 'secondary-printer', name: 'Secondary printer', printType: 'filament' }])
    await primary.createInvite({ id: 'primary-invite', tokenHash: 'primary-token', role: 'admin', expiresAt: Date.now() + 60_000 })
    await secondary.createInvite({
      id: 'secondary-invite',
      tokenHash: 'secondary-token',
      role: 'requester',
      expiresAt: Date.now() + 60_000,
    })
    await primary.createUploadSession('primary-upload', 'owner', Date.now() + 60_000, 3)
    await secondary.createUploadSession('secondary-upload', 'owner', Date.now() + 60_000, 3)

    expect(await primary.getRequest(primaryRequest)).toBeTruthy()
    expect(await primary.getRequest(secondaryRequest)).toBeUndefined()
    expect(await secondary.getRequest(primaryRequest)).toBeUndefined()
    expect(await secondary.getRequest(secondaryRequest)).toBeTruthy()
    expect(await primary.getSetting('board')).toEqual({ privateRequests: true })
    expect(await secondary.getSetting('board')).toEqual({ privateRequests: false })
    expect(await primary.getSetting('printers')).toEqual([{ id: 'primary-printer', name: 'Primary printer', printType: 'resin' }])
    expect(await secondary.getSetting('printers')).toEqual([{ id: 'secondary-printer', name: 'Secondary printer', printType: 'filament' }])
    expect((await primary.listAssetGenerationJobs()).every((job) => job.requestId === primaryRequest)).toBe(true)
    expect((await secondary.listAssetGenerationJobs()).every((job) => job.requestId === secondaryRequest)).toBe(true)
    expect(await primary.listInvites()).toEqual([expect.objectContaining({ id: 'primary-invite' })])
    expect(await secondary.listInvites()).toEqual([expect.objectContaining({ id: 'secondary-invite' })])
    expect(await primary.findInvite('secondary-token')).toBeUndefined()
    expect(await secondary.findInvite('primary-token')).toBeUndefined()
    await expect(
      repository.database
        .insert(requestStatuses)
        .values({ workspaceId: 'test-workspace', requestId: secondaryRequest, statusId: 'forged', quantity: 1 })
        .run(),
    ).rejects.toThrow()
    expect(await primary.uploadIdsOwnedBy('owner')).toEqual(['primary-upload'])
    expect(await secondary.uploadIdsOwnedBy('owner')).toEqual(['secondary-upload'])
    expect(await secondary.listUsers()).toEqual([expect.objectContaining({ id: 'owner', workspaceRole: 'owner' })])
  })

  it('rejects cross-workspace operation and upload relationships', async () => {
    const primary = await repository.scoped('test-workspace')
    const secondaryWorkspace = await repository.createWorkspace({ id: 'owner' }, 'Second farm')
    const secondary = await repository.scoped(secondaryWorkspace.id)
    const requestId = await primary.createRequest({
      name: 'Primary model',
      fileName: 'primary.stl',
      filePath: 'todo/primary.stl',
      quantity: 1,
      ownerUserId: 'owner',
    })
    await primary.createUploadSession('primary-upload', 'owner', Date.now() + 60_000, 3)
    await secondary.createUploadSession('secondary-upload', 'owner', Date.now() + 60_000, 3)

    await expect(secondary.beginOperation(crypto.randomUUID(), { kind: 'delete', requestId, assets: [] })).rejects.toThrow(
      expect.objectContaining({ status: 404 }),
    )
    await expect(
      secondary.beginUploadOperation(crypto.randomUUID(), {
        kind: 'upload',
        uploadId: 'primary-upload',
        ownerId: 'owner',
        requestId: crypto.randomUUID(),
        partPath: 'uploads/primary-upload.part',
        destinationPath: 'todo/model.stl',
        request: { name: 'Model', fileName: 'model.stl', quantity: 1, ownerUserId: 'owner' },
      }),
    ).rejects.toThrow(expect.objectContaining({ status: 404 }))
    await expect(
      repository.database
        .update(uploadSessions)
        .set({ completedRequestId: requestId })
        .where(and(eq(uploadSessions.workspaceId, secondaryWorkspace.id), eq(uploadSessions.id, 'secondary-upload')))
        .run(),
    ).rejects.toThrow()
  })

  it('allows matching workspace names for any owner', async () => {
    const first = await repository.createWorkspace({ id: 'owner' }, 'Test farm')
    const second = await repository.createWorkspace({ id: 'other' }, 'test farm')
    const third = await repository.createWorkspace({ id: 'owner' }, 'Test farm')

    expect(first.slug).toBe('test-farm')
    expect(second.slug).toBe('test-farm-2')
    expect(third.slug).toBe('test-farm-3')
  })

  it('atomically limits the number of workspaces an account owns', async () => {
    await repository.createWorkspace({ id: 'owner' }, 'First', {}, 3)
    await repository.createWorkspace({ id: 'owner' }, 'Second', {}, 3)

    const created = await Promise.allSettled([
      repository.createWorkspace({ id: 'owner' }, 'Third', {}, 3),
      repository.createWorkspace({ id: 'owner' }, 'Fourth', {}, 3),
    ])

    expect(created.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  })

  it('provisions one personal workspace for a user without memberships', async () => {
    const now = new Date()
    await repository.database
      .insert(user)
      .values({
        id: 'personal-owner',
        name: 'Personal Owner',
        email: 'personal@example.com',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
        role: 'requester',
      })
      .run()
    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const first = await repository.ensurePersonalWorkspace({ id: 'personal-owner', name: 'Personal Owner' })
      const second = await repository.ensurePersonalWorkspace({ id: 'personal-owner', name: 'Personal Owner' })

      expect(second).toEqual(first)
      expect(await repository.listWorkspacesForUser('personal-owner')).toEqual([expect.objectContaining({ id: first!.id, role: 'owner' })])
    } finally {
      process.env.NODE_ENV = previousNodeEnv
    }
  })

  it('does not provision a personal workspace for an existing member', async () => {
    expect(await repository.ensurePersonalWorkspace({ id: 'maker', name: 'Maker' })).toBeUndefined()
  })

  it('lets an existing matching account accept an emailed invite exactly once', async () => {
    const now = new Date()
    await repository.database
      .insert(user)
      .values({
        id: 'invitee',
        name: 'Invitee',
        email: 'invitee@example.com',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
        role: 'requester',
      })
      .run()
    await repository.createInvite({
      id: 'emailed-invite',
      tokenHash: 'emailed-token',
      role: 'admin',
      recipientEmail: 'invitee@example.com',
      expiresAt: Date.now() + 60_000,
    })

    expect(await repository.acceptInviteForUser('emailed-token', Date.now(), { id: 'invitee', email: 'invitee@example.com' })).toBeTruthy()
    expect(
      await repository.acceptInviteForUser('emailed-token', Date.now(), { id: 'invitee', email: 'invitee@example.com' }),
    ).toBeUndefined()
    expect(await repository.workspaceSlugForInvite('emailed-token', Date.now())).toBe('test-workspace')
    expect(await repository.listWorkspacesForUser('invitee')).toEqual([expect.objectContaining({ id: 'test-workspace', role: 'admin' })])
  })

  it('keeps an emailed invite usable after the wrong account tries to accept it', async () => {
    const expiresAt = Date.now() + 60_000
    await repository.createInvite({
      id: 'bound-invite',
      tokenHash: 'bound-token',
      role: 'requester',
      recipientEmail: 'right@example.com',
      expiresAt,
    })

    await expect(
      repository.acceptInviteForUser('bound-token', Date.now(), { id: 'wrong-user', email: 'wrong@example.com' }),
    ).rejects.toThrow(expect.objectContaining({ status: 403 }))
    expect(await repository.findInvite('bound-token')).toMatchObject({ usedAt: undefined })
    expect(await repository.workspaceSlugForInvite('bound-token', Date.now())).toBe('test-workspace')
  })

  it('persists operation state transitions with the associated metadata commit', async () => {
    const id = await repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    const operationId = crypto.randomUUID()
    await repository.beginOperation(operationId, {
      kind: 'move',
      requestId: id,
      fromStatus: 'todo',
      toStatus: 'done',
      count: 1,
      sourcePath: 'todo/gear.stl',
      destinationPath: 'done/gear.stl',
    })
    await repository.markOperationAssetsMoved(operationId)
    await repository.completeMoveOperation(operationId, { id, from: 'todo', to: 'done', count: 1, filePath: 'done/gear.stl' })
    expect(await repository.getRequest(id)).toMatchObject({ counts: { todo: 0, done: 1 }, filePath: 'done/gear.stl' })
    expect(await repository.listOperations()).toMatchObject([{ id: operationId, state: 'committed' }])
    await repository.finishOperation(operationId)
    expect(await repository.listOperations()).toHaveLength(0)
  })

  it('preserves requester priority when moving between statuses', async () => {
    const id = await repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    await repository.reorderRequest(id, 4)
    await repository.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1, filePath: 'in-progress/gear.stl', order: 4 })
    await repository.moveCopies({ id, from: 'in_progress', to: 'todo', count: 1, filePath: 'todo/gear.stl', order: 2 })
    await repository.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1, filePath: 'in-progress/gear.stl', order: 9 })
    expect((await repository.getRequest(id))?.orders).toMatchObject({ todo: 4, in_progress: 4 })
  })

  it('tracks when a request most recently entered the completed status', async () => {
    const id = await repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })

    await repository.moveCopies({ id, from: 'todo', to: 'done', count: 1, filePath: 'done/gear.stl', movedAt: 100 })
    expect((await repository.getRequest(id))?.completedAt).toBe(100)
    await repository.moveCopies({ id, from: 'done', to: 'todo', count: 1, filePath: 'todo/gear.stl', movedAt: 200 })
    expect((await repository.getRequest(id))?.completedAt).toBeUndefined()
    await repository.moveCopies({ id, from: 'todo', to: 'done', count: 1, filePath: 'done/gear.stl', movedAt: 300 })
    expect((await repository.getRequest(id))?.completedAt).toBe(300)
  })

  it.skipIf(backend === 'postgres')('records every migration for fresh databases', async () => {
    const database = createDatabase(':memory:')
    const migrated = await DrizzleRepository.create(database)

    expect(await database.get(drizzleSql`SELECT count(*) count FROM __drizzle_migrations`)).toEqual({ count: 20 })
    await migrated.close()
  })

  it('archives a used printer without changing its request history', async () => {
    const printer: PrinterProfile = {
      id: 'retired-filament',
      name: 'Retired filament printer',
      printType: 'filament',
    }
    await repository.setSetting('printers', [printer])
    const request = await repository.createRequest({
      name: 'Assigned model',
      fileName: 'assigned.stl',
      filePath: 'todo/assigned.stl',
      quantity: 1,
      ownerUserId: 'maker',
      printerId: printer.id,
    })

    await repository.replacePrinterProfiles([])

    expect(await repository.getRequest(request)).toMatchObject({ printerId: printer.id, requestedPrintType: undefined })
    expect(await repository.getSetting<PrinterProfile[]>('printers')).toEqual([{ ...printer, archived: true, used: true }])
  })

  it('removes a printer that has never been assigned', async () => {
    await repository.setSetting('printers', [{ id: 'unused', name: 'Unused', printType: 'resin' }])

    await repository.replacePrinterProfiles([])

    expect(await repository.getSetting<PrinterProfile[]>('printers')).toEqual([])
  })

  it('restores an archived printer without losing its usage history', async () => {
    const printer: PrinterProfile = { id: 'archived', name: 'Archived', printType: 'resin', archived: true, used: true }
    await repository.setSetting('printers', [printer])

    await repository.replacePrinterProfiles([{ ...printer, archived: undefined }])

    expect(await repository.getSetting<PrinterProfile[]>('printers')).toEqual([
      { id: printer.id, name: printer.name, printType: printer.printType, used: true },
    ])
  })

  it('remembers printer usage after its request is unassigned', async () => {
    const printer: PrinterProfile = { id: 'used', name: 'Used', printType: 'resin' }
    await repository.setSetting('printers', [printer])
    const request = await repository.createRequest({
      name: 'Assigned model',
      fileName: 'assigned.stl',
      filePath: 'todo/assigned.stl',
      quantity: 1,
      ownerUserId: 'maker',
      printerId: printer.id,
    })
    await repository.updateRequest(request, { printerId: null })

    await repository.replacePrinterProfiles([])

    expect(await repository.getSetting<PrinterProfile[]>('printers')).toEqual([{ ...printer, archived: true, used: true }])
  })

  it('does not assign existing pooled requests when a printer is added', async () => {
    const request = await repository.createRequest({
      name: 'Pooled model',
      fileName: 'pooled.stl',
      filePath: 'todo/pooled.stl',
      quantity: 1,
      ownerUserId: 'maker',
      requestedPrintType: 'resin',
    })

    await repository.replacePrinterProfiles([{ id: 'small', name: 'Small', printType: 'resin', widthMm: 100, depthMm: 100 }])

    expect(await repository.getRequest(request)).toMatchObject({ printerId: undefined, requestedPrintType: 'resin' })
  })

  it('persists predefined printer matches by name when the repository starts', async () => {
    await repository.setSetting('printers', [
      {
        id: 'mars-2',
        name: 'Elegoo Mars 2',
        printType: 'resin',
        widthMm: 100,
        depthMm: 100,
      },
    ])

    const reopened = await reopenRepository()

    expect((await repository.getSetting<PrinterProfile[]>('printers'))?.[0]?.presetId).toBe('resin-elegoo-mars-2')
    await reopened.close()
  })

  it('does not assign measured pooled requests when printers are added', async () => {
    const request = await repository.createRequest({
      name: 'Large pooled model',
      fileName: 'large-pooled.stl',
      filePath: 'todo/large-pooled.stl',
      quantity: 1,
      ownerUserId: 'maker',
      requestedPrintType: 'resin',
    })
    await repository.setModelDimensions(request, { widthMm: 150, depthMm: 80, heightMm: 120 })

    await repository.replacePrinterProfiles([
      { id: 'small', name: 'Small', printType: 'resin', widthMm: 100, depthMm: 100, heightMm: 100 },
      { id: 'large', name: 'Large', printType: 'resin', widthMm: 200, depthMm: 200, heightMm: 200 },
    ])

    expect(await repository.getRequest(request)).toMatchObject({ printerId: undefined, requestedPrintType: 'resin' })
  })

  it('backfills existing pooled requests when the repository starts', async () => {
    await repository.setSetting('printers', [
      { id: 'small', name: 'Small', printType: 'resin', widthMm: 100, depthMm: 100 },
      { id: 'large', name: 'Large', printType: 'resin', widthMm: 200, depthMm: 200 },
    ])
    for (const printerId of ['small', 'large']) {
      await repository.createRequest({
        name: `${printerId} workload`,
        fileName: `${printerId}.stl`,
        filePath: `todo/${printerId}.stl`,
        quantity: 1,
        ownerUserId: 'maker',
        printerId,
      })
    }
    const pooled = await repository.createRequest({
      name: 'Existing pooled model',
      fileName: 'existing-pooled.stl',
      filePath: 'todo/existing-pooled.stl',
      quantity: 1,
      ownerUserId: 'maker',
      requestedPrintType: 'resin',
    })

    const reopened = await reopenRepository()

    expect(await repository.getRequest(pooled)).toMatchObject({ printerId: 'large', requestedPrintType: undefined })
    await reopened.close()
  })

  it('does not rewrite unchanged automatic printer assignments when the repository reopens', async () => {
    await repository.setSetting('printers', [{ id: 'small', name: 'Small', printType: 'resin' }])
    const request = await repository.createRequest({
      name: 'Already assigned model',
      fileName: 'already-assigned.stl',
      filePath: 'todo/already-assigned.stl',
      quantity: 1,
      ownerUserId: 'maker',
      printerId: 'small',
      automaticPrinterAssignment: true,
    })
    await repository.database.update(requests).set({ updatedAt: 123 }).where(eq(requests.id, request)).run()

    const reopened = await reopenRepository()

    expect(await repository.getRequest(request)).toMatchObject({ printerId: 'small', updatedAt: 123 })
    await reopened.close()
  })

  it('repairs stale automatic printer assignments when the repository reopens', async () => {
    await repository.setSetting('printers', [
      { id: 'small', name: 'Small', printType: 'resin' },
      { id: 'large', name: 'Large', printType: 'resin' },
    ])
    await repository.createRequest({
      name: 'Small printer workload',
      fileName: 'small-workload.stl',
      filePath: 'todo/small-workload.stl',
      quantity: 1,
      ownerUserId: 'maker',
      printerId: 'small',
    })
    const request = await repository.createRequest({
      name: 'Stale assignment',
      fileName: 'stale-assignment.stl',
      filePath: 'todo/stale-assignment.stl',
      quantity: 1,
      ownerUserId: 'maker',
      printerId: 'small',
      automaticPrinterAssignment: true,
    })
    await repository.database.update(requests).set({ updatedAt: 123 }).where(eq(requests.id, request)).run()

    const reopened = await reopenRepository()

    expect(await repository.getRequest(request)).toMatchObject({ printerId: 'large' })
    expect((await repository.getRequest(request))?.updatedAt).not.toBe(123)
    await reopened.close()
  })

  it('reconciles added statuses and rejects removed statuses that contain copies', async () => {
    const id = await repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    await repository.database
      .delete(requestStatuses)
      .where(
        and(eq(requestStatuses.workspaceId, 'test-workspace'), eq(requestStatuses.requestId, id), eq(requestStatuses.statusId, 'up_next')),
      )
      .run()
    await repository.reconcileWorkflow()
    expect((await repository.getRequest(id))?.counts.up_next).toBe(0)
    await repository.database
      .insert(requestStatuses)
      .values({ workspaceId: 'test-workspace', requestId: id, statusId: 'retired', quantity: 1 })
      .run()
    await expect(repository.reconcileWorkflow()).rejects.toThrow('still has copies')
  })

  it('persists incomplete-upload ownership, quotas, and completion receipts', async () => {
    const expires = Date.now() + 60_000
    expect(await repository.hasActiveUploads(Date.now())).toBe(false)
    expect(await repository.createUploadSession('persisted-upload-id', 'owner', expires, 3)).toEqual({ fresh: true })
    expect(await repository.reserveUpload('persisted-upload-id', 'owner', 60, expires, { count: 2, bytes: 100 })).toBe(true)
    expect(await repository.hasActiveUploads(Date.now())).toBe(true)
    await repository.createUploadSession('second-upload-id', 'owner', expires, 3)
    expect(await repository.reserveUpload('second-upload-id', 'owner', 41, expires, { count: 2, bytes: 100 })).toBe(false)
    await expect(repository.createUploadSession('persisted-upload-id', 'attacker', expires, 3)).rejects.toThrow(
      expect.objectContaining({ status: 409 }),
    )
    await expect(repository.database.delete(user).where(eq(user.id, 'owner')).run()).rejects.toThrow()
  })

  it('enforces a shared incomplete upload quota across managed workspaces', async () => {
    const expires = Date.now() + 60_000
    await repository.claimManagedStorage('owner', 3)
    await repository.createUploadSession('first-workspace-upload', 'owner', expires, 3)
    expect(
      await repository.reserveUpload('first-workspace-upload', 'owner', 60, expires, { count: 3, bytes: 100, managedBytes: 100 }),
    ).toBe(true)
    const second = await repository.createWorkspace({ id: 'owner' }, 'Second managed workspace')
    const scoped = await repository.scoped(second.id)
    await scoped.claimManagedStorage('owner', 3)
    await scoped.createUploadSession('second-workspace-upload', 'owner', expires, 3)
    expect(await scoped.reserveUpload('second-workspace-upload', 'owner', 41, expires, { count: 3, bytes: 100, managedBytes: 100 })).toBe(
      false,
    )
  })

  it('atomically reserves managed asset capacity', async () => {
    await repository.claimManagedStorage('owner', 3)
    await repository.reconcileManagedStorageUsage(0)
    const accepted = await Promise.all([repository.reserveManagedAssetBytes(60, 100), repository.reserveManagedAssetBytes(60, 100)])
    expect(accepted.filter(Boolean)).toHaveLength(1)
  })

  it('resolves the largest active managed storage plan for an account', async () => {
    const now = new Date()
    await repository.database
      .insert(subscription)
      .values([
        { id: 'inactive', plan: 'pro', referenceId: 'owner', status: 'canceled', createdAt: now, updatedAt: now },
        { id: 'active', plan: 'supporter', referenceId: 'owner', status: 'active', createdAt: now, updatedAt: now },
      ])
      .run()

    expect(await repository.managedStoragePlan('owner')).toBe('supporter')
  })

  it('defaults subscription timestamps when Better Auth omits them', async () => {
    await repository.database.insert(subscription).values({ id: 'pending', plan: 'supporter', referenceId: 'owner' }).run()

    const stored = await repository.database.select().from(subscription).where(eq(subscription.id, 'pending')).get()
    expect({ createdAt: stored?.createdAt instanceof Date, updatedAt: stored?.updatedAt instanceof Date }).toEqual({
      createdAt: true,
      updatedAt: true,
    })
  })

  it('atomically reserves managed capacity across workspaces', async () => {
    await repository.claimManagedStorage('owner', 3)
    await repository.reconcileManagedStorageUsage(0)
    const second = await repository.scoped((await repository.createWorkspace({ id: 'owner' }, 'Second managed workspace')).id)
    await second.claimManagedStorage('owner', 3)
    await second.reconcileManagedStorageUsage(0)

    const accepted = await Promise.all([repository.reserveManagedAssetBytes(60, 100), second.reserveManagedAssetBytes(60, 100)])

    expect(accepted.filter(Boolean)).toHaveLength(1)
  })

  it('durably converts an expired upload reservation exactly once during finalization', async () => {
    const expired = Date.now() - 1
    await repository.claimManagedStorage('owner', 3)
    await repository.createUploadSession('finalizing-upload', 'owner', expired, 3)
    await repository.reserveUpload('finalizing-upload', 'owner', 60, Date.now() + 60_000, {
      count: 3,
      bytes: 100,
      managedBytes: 100,
    })
    await repository.database.update(uploadSessions).set({ expiresAt: expired }).where(eq(uploadSessions.id, 'finalizing-upload')).run()

    expect(await repository.beginManagedUploadFinalize('finalizing-upload')).toBe(60)
    expect(await repository.expireUploads(Date.now())).toEqual([])
    expect(await repository.activeUploadIds(Date.now())).toContain('finalizing-upload')
    expect(await repository.beginManagedUploadFinalize('finalizing-upload')).toBe(60)
    await repository.finishManagedUploadFinalize('finalizing-upload', 60)
    await expect(repository.finishManagedUploadFinalize('finalizing-upload', 60)).resolves.toBeUndefined()
    expect(await repository.managedStorageRemaining(100)).toBe(40)
  })

  it('reconciliation clears interrupted asset writes but preserves durable upload finalization', async () => {
    await repository.claimManagedStorage('owner', 3)
    await repository.createUploadSession('finalizing-upload', 'owner', Date.now() + 60_000, 1)
    await repository.reserveUpload('finalizing-upload', 'owner', 40, Date.now() + 60_000, {
      count: 1,
      bytes: 100,
      managedBytes: 100,
    })
    await repository.beginManagedUploadFinalize('finalizing-upload')
    await repository.reconcileManagedStorageUsage(0)
    expect(await repository.reserveManagedAssetBytes(60, 100)).toBe(true)
    await repository.reconcileManagedStorageUsage(0)
    expect(await repository.managedStorageRemaining(100)).toBe(60)
  })

  it('returns the finalize reservation when an upload operation is abandoned', async () => {
    await repository.claimManagedStorage('owner', 3)
    await repository.createUploadSession('abandoned-upload', 'owner', Date.now() + 60_000, 3)
    await repository.reserveUpload('abandoned-upload', 'owner', 60, Date.now() + 60_000, {
      count: 3,
      bytes: 100,
      managedBytes: 100,
    })
    const operationId = crypto.randomUUID()
    await repository.beginOperation(operationId, {
      kind: 'upload',
      uploadId: 'abandoned-upload',
      ownerId: 'owner',
      requestId: crypto.randomUUID(),
      partPath: 'uploads/abandoned-upload.part',
      destinationPath: 'todo/model.stl',
      request: { name: 'Model', fileName: 'model.stl', quantity: 1, ownerUserId: 'owner' },
    })
    await repository.beginManagedUploadFinalize('abandoned-upload')

    await repository.abandonOperation(operationId)

    expect(await repository.managedStorageRemaining(100)).toBe(100)
    expect(await repository.expireUploads(Date.now() + 120_000)).toContain('abandoned-upload')
  })

  it('allows three managed workspaces to share one owner entitlement', async () => {
    await repository.claimManagedStorage('owner', 3)
    const second = await repository.scoped((await repository.createWorkspace({ id: 'owner' }, 'Second workspace')).id)
    const third = await repository.scoped((await repository.createWorkspace({ id: 'owner' }, 'Third workspace')).id)
    const fourth = await repository.scoped((await repository.createWorkspace({ id: 'owner' }, 'Fourth workspace')).id)

    await expect(Promise.all([second.claimManagedStorage('owner', 3), third.claimManagedStorage('owner', 3)])).resolves.toEqual([
      true,
      true,
    ])
    await expect(second.claimManagedStorage('owner', 3)).resolves.toBe(false)
    await expect(fourth.claimManagedStorage('owner', 3)).rejects.toMatchObject({ status: 409 })
    await second.releaseManagedStorage()
    await expect(fourth.claimManagedStorage('owner', 3)).resolves.toBe(true)
  })

  it('atomically reserves a request against overlapping durable operations', async () => {
    const id = await repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    await repository.beginOperation(crypto.randomUUID(), {
      kind: 'move',
      requestId: id,
      fromStatus: 'todo',
      toStatus: 'done',
      count: 1,
      sourcePath: 'todo/gear.stl',
      destinationPath: 'done/gear.stl',
    })
    await expect(repository.beginOperation(crypto.randomUUID(), { kind: 'delete', requestId: id, assets: [] })).rejects.toThrow(
      expect.objectContaining({ status: 409 }),
    )
    await expect(repository.updateRequest(id, { quantity: 2 })).rejects.toThrow(expect.objectContaining({ status: 409 }))
    expect(await repository.getRequest(id)).toMatchObject({ quantity: 1, filePath: 'todo/gear.stl' })
  })

  it('rejects move completion arguments that differ from the stored operation payload', async () => {
    const requestId = await repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    const otherRequestId = await repository.createRequest({
      name: 'Bracket',
      fileName: 'bracket.stl',
      filePath: 'todo/bracket.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    const operationId = crypto.randomUUID()
    await repository.beginOperation(operationId, {
      kind: 'move',
      requestId,
      fromStatus: 'todo',
      toStatus: 'done',
      count: 1,
      sourcePath: 'todo/gear.stl',
      destinationPath: 'done/gear.stl',
    })
    await repository.markOperationAssetsMoved(operationId)

    await expect(
      repository.completeMoveOperation(operationId, {
        id: otherRequestId,
        from: 'todo',
        to: 'done',
        count: 1,
        filePath: 'done/bracket.stl',
      }),
    ).rejects.toThrow('operation payload mismatch')
    expect(await repository.getRequest(requestId)).toMatchObject({ counts: { todo: 1, done: 0 }, filePath: 'todo/gear.stl' })
    expect(await repository.getRequest(otherRequestId)).toMatchObject({ counts: { todo: 1, done: 0 }, filePath: 'todo/bracket.stl' })
    expect(await repository.listOperations()).toMatchObject([{ id: operationId, state: 'assets_moved' }])
  })

  it('rejects delete completion for a different request or operation kind', async () => {
    const requestId = await repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    const otherRequestId = await repository.createRequest({
      name: 'Bracket',
      fileName: 'bracket.stl',
      filePath: 'todo/bracket.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    const deleteOperationId = crypto.randomUUID()
    await repository.beginOperation(deleteOperationId, { kind: 'delete', requestId, assets: [] })

    await expect(repository.completeDeleteOperation(deleteOperationId, otherRequestId)).rejects.toThrow('operation payload mismatch')
    expect(await repository.getRequest(requestId)).toBeDefined()
    expect(await repository.getRequest(otherRequestId)).toBeDefined()
    expect(await repository.listOperations()).toMatchObject([{ id: deleteOperationId, state: 'prepared' }])

    const moveOperationId = crypto.randomUUID()
    await repository.abandonOperation(deleteOperationId)
    await repository.beginOperation(moveOperationId, {
      kind: 'move',
      requestId,
      fromStatus: 'todo',
      toStatus: 'done',
      count: 1,
      sourcePath: 'todo/gear.stl',
      destinationPath: 'done/gear.stl',
    })
    await expect(repository.completeDeleteOperation(moveOperationId, requestId)).rejects.toThrow('operation kind mismatch')
    expect(await repository.getRequest(requestId)).toBeDefined()
  })

  it('rejects upload completion data that differs from the stored operation payload', async () => {
    const operationId = crypto.randomUUID()
    const payload = {
      kind: 'upload' as const,
      uploadId: 'journaled-upload',
      ownerId: 'owner',
      requestId: crypto.randomUUID(),
      partPath: 'uploads/journaled-upload.part',
      destinationPath: 'todo/model.stl',
      request: {
        name: 'Model',
        fileName: 'model.stl',
        quantity: 1,
        ownerUserId: 'owner',
      },
    }
    await repository.createUploadSession(payload.uploadId, payload.ownerId, Date.now() + 60_000, 3)
    await repository.beginUploadOperation(operationId, payload)

    await expect(repository.completeUploadOperation(operationId, { ...payload, requestId: crypto.randomUUID() })).rejects.toThrow(
      'operation payload mismatch',
    )
    expect(await repository.getRequest(payload.requestId)).toBeUndefined()
    expect(await repository.getCompletedUpload(payload.uploadId, payload.ownerId)).toBeUndefined()
    expect(await repository.listOperations()).toMatchObject([{ id: operationId, state: 'prepared', payload }])
  })

  it('does not persist a newly rejected upload session', async () => {
    const expires = Date.now() + 60_000
    for (const id of ['quota-upload-one', 'quota-upload-two', 'quota-upload-three']) {
      expect(await repository.createUploadSession(id, 'owner', expires, 3)).toEqual({ fresh: true })
      expect(await repository.reserveUpload(id, 'owner', 1, expires, { count: 3, bytes: 100 })).toBe(true)
    }
    await expect(repository.createUploadSession('quota-upload-four', 'owner', expires, 3)).rejects.toThrow(
      expect.objectContaining({ status: 429 }),
    )
    expect(
      (await repository.database.select({ count: count() }).from(uploadSessions).where(eq(uploadSessions.ownerId, 'owner')).get())?.count,
    ).toBe(3)
    await repository.expireUploads(expires + 1)
    expect(await repository.createUploadSession('quota-upload-four', 'owner', expires + 60_000, 3)).toEqual({ fresh: true })
  })

  it('does not let rejected upload creations consume future quota', async () => {
    const expires = Date.now() + 60_000
    for (const id of ['rejected-upload-one', 'rejected-upload-two', 'rejected-upload-three']) {
      await repository.createUploadSession(id, 'owner', expires, 3)
      expect(await repository.reserveUpload(id, 'owner', 101, expires, { count: 3, bytes: 100 })).toBe(false)
    }
    expect(await repository.createUploadSession('accepted-upload', 'owner', expires, 3)).toEqual({ fresh: true })
    expect(await repository.reserveUpload('accepted-upload', 'owner', 100, expires, { count: 3, bytes: 100 })).toBe(true)
    expect(await repository.incompleteUploadStats(Date.now())).toEqual({ count: 1, bytes: 100 })
  })

  it.skipIf(backend === 'postgres')('enforces incomplete-upload quotas after reopening the database', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-sqlite-'))
    const file = path.join(directory, 'test.sqlite')
    const expires = Date.now() + 60_000
    const first = await DrizzleRepository.open(file)
    await insertUser(first, { id: 'owner', name: 'Owner', email: 'owner@example.com' })
    await first.createUploadSession('restart-upload-one', 'owner', expires, 3)
    expect(await first.reserveUpload('restart-upload-one', 'owner', 70, expires, { count: 2, bytes: 100 })).toBe(true)
    await first.createUploadSession('restart-upload-two', 'owner', expires, 2)
    expect(await first.reserveUpload('restart-upload-two', 'owner', 30, expires, { count: 2, bytes: 100 })).toBe(true)
    await expect(first.createUploadSession('restart-upload-rejected', 'owner', expires, 2)).rejects.toThrow(
      expect.objectContaining({ status: 429 }),
    )
    await first.close()
    const reopened = await DrizzleRepository.open(file)
    expect(await reopened.reserveUpload('restart-upload-two', 'owner', 31, expires, { count: 2, bytes: 100 })).toBe(false)
    expect(await reopened.createUploadSession('restart-upload-one', 'owner', expires, 2)).toEqual({ fresh: false })
    await expect(reopened.createUploadSession('restart-upload-rejected', 'owner', expires, 2)).rejects.toThrow(
      expect.objectContaining({ status: 429 }),
    )
    await reopened.close()
    await fs.promises.rm(directory, { recursive: true, force: true })
  })
})

async function truncatePostgreSQL(url: string) {
  const client = postgres(url, { max: 1, onnotice: () => undefined })
  try {
    await client.unsafe(
      `DO $$ DECLARE table_name text; BEGIN FOR table_name IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP EXECUTE 'TRUNCATE TABLE public.' || quote_ident(table_name) || ' CASCADE'; END LOOP; END $$`,
    )
  } finally {
    await client.end()
  }
}

async function resetPostgreSQL(url: string) {
  const client = postgres(url, { max: 1, onnotice: () => undefined })
  try {
    await client`DROP SCHEMA public CASCADE`
    await client`DROP SCHEMA IF EXISTS drizzle CASCADE`
    await client`CREATE SCHEMA public`
  } finally {
    await client.end()
  }
}

describe('databasePath', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('uses the STL Quest database name for new data directories', async () => {
    const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-database-'))
    vi.stubEnv('DATA_DIR', temporary)

    expect(databasePath()).toBe(path.join(temporary, 'stlquest.sqlite'))
  })
})
