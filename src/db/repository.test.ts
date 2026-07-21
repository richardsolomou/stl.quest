import Database from 'better-sqlite3'
import { and, count, eq, sql as drizzleSql } from 'drizzle-orm'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DrizzleRepository } from './repository'
import { databasePath } from './paths'
import { createDatabase } from './connection'
import type { AccountRole, PrinterProfile, WorkspaceRole } from '../core/types'
import { member, requests, requestStatuses, uploadSessions, user } from './schema'

function insertUser(
  repository: DrizzleRepository,
  values: { id: string; name: string; email: string; accountRole?: AccountRole; workspaceRole?: WorkspaceRole; color?: string },
) {
  const now = new Date()
  repository.database
    .insert(user)
    .values({ ...values, role: values.accountRole ?? 'requester', emailVerified: true, createdAt: now, updatedAt: now })
    .run()
  repository.addWorkspaceMember(values.id, values.workspaceRole ?? 'member')
}

describe('DrizzleRepository contract', () => {
  let repository: DrizzleRepository

  beforeEach(() => {
    repository = new DrizzleRepository(createDatabase(':memory:'))
    insertUser(repository, { id: 'maker', name: 'Maker', email: 'maker@example.com' })
    insertUser(repository, { id: 'other', name: 'Other', email: 'other@example.com' })
    insertUser(repository, { id: 'owner', name: 'Owner', email: 'owner@example.com' })
    insertUser(repository, { id: 'attacker', name: 'Attacker', email: 'attacker@example.com' })
  })
  afterEach(() => repository.close())

  it('does not trust workspaces owned by ordinary users with local storage', () => {
    expect(repository.isSuperAdminWorkspace()).toBe(false)
  })

  it('trusts workspaces owned by super admins with local storage', () => {
    repository.database.update(user).set({ role: 'super_admin' }).where(eq(user.id, 'owner')).run()
    repository.database.update(member).set({ role: 'owner' }).where(eq(member.userId, 'owner')).run()

    expect(repository.isSuperAdminWorkspace()).toBe(true)
  })

  it('persists requests and tracks copy quantities transactionally', () => {
    const id = repository.createRequest({
      name: 'Bracket',
      fileName: 'bracket.stl',
      filePath: 'todo/bracket.stl',
      quantity: 3,
      ownerUserId: 'maker',
      notes: 'PETG',
      sourceUrl: 'https://example.com/bracket',
      printerId: 'printer-id',
    })
    expect(repository.getRequest(id)).toMatchObject({
      counts: { todo: 3, up_next: 0, in_progress: 0, done: 0 },
      sourceUrl: 'https://example.com/bracket',
      requestedPrintType: undefined,
      printerId: 'printer-id',
    })

    repository.updateRequest(id, { printerId: 'next-printer' })
    expect(repository.getRequest(id)).toMatchObject({ printerId: 'next-printer' })

    repository.moveCopies({ id, from: 'todo', to: 'in_progress', count: 2, filePath: 'todo/bracket.stl', order: 4 })
    expect(repository.getRequest(id)).toMatchObject({ counts: { todo: 1, in_progress: 2, done: 0 }, orders: { in_progress: undefined } })
    expect(() => repository.moveCopies({ id, from: 'todo', to: 'done', count: 2, filePath: 'todo/bracket.stl' })).toThrow('invalid move')
    expect(repository.getRequest(id)?.counts).toEqual({ todo: 1, up_next: 0, in_progress: 2, post_processing: 0, done: 0 })
  })

  it('tracks thumbnail and preview generation as durable stages', () => {
    const id = repository.createRequest({
      name: 'Stages',
      fileName: 'stages.stl',
      filePath: 'todo/stages.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    expect(repository.assetGenerationJobs(id)).toEqual([
      expect.objectContaining({ stage: 'preview', status: 'pending' }),
      expect.objectContaining({ stage: 'thumbnail', status: 'pending' }),
    ])
    repository.startAssetGeneration(id, ['thumbnail', 'preview'])
    repository.finishAssetGeneration(id, 'thumbnail', { status: 'ready', path: '.stlquest/thumbnails/stages.png' })
    repository.finishAssetGeneration(id, 'preview', { status: 'skipped' })
    expect(repository.assetGenerationJobs(id)).toEqual([
      expect.objectContaining({ stage: 'preview', status: 'skipped' }),
      expect.objectContaining({ stage: 'thumbnail', status: 'ready' }),
    ])
    expect(repository.requestsNeedingAssets()).toEqual([])
  })

  it('requeues existing previews through the compressed preview migration', () => {
    const id = repository.createRequest({
      name: 'Quantized preview',
      fileName: 'quantized.stl',
      filePath: 'todo/quantized.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    repository.startAssetGeneration(id, ['thumbnail', 'preview'])
    repository.finishAssetGeneration(id, 'thumbnail', { status: 'ready', path: '.stlquest/thumbnails/quantized.png' })
    repository.finishAssetGeneration(id, 'preview', { status: 'ready', path: '.stlquest/previews/quantized.phm' })
    const migration = fs
      .readFileSync(path.resolve('drizzle/0004_regenerate_compressed_previews.sql'), 'utf8')
      .replaceAll('--> statement-breakpoint', '')
    repository.database.$client.exec(migration)
    expect(repository.assetGenerationJobs(id)).toContainEqual(expect.objectContaining({ stage: 'preview', status: 'pending' }))
    expect(repository.requestsNeedingAssets()).toEqual([id])
  })

  it('queries request metadata, ranges, statuses, facets, and whitelisted sorting', () => {
    const bracket = repository.createRequest({
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
    const gear = repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 1,
      ownerUserId: 'other',
    })
    repository.moveCopies({ id: bracket, from: 'todo', to: 'in_progress', count: 1, filePath: 'todo/bracket.stl' })
    repository.database.update(requests).set({ createdAt: 100, updatedAt: 300 }).where(eq(requests.id, bracket)).run()
    repository.database.update(requests).set({ createdAt: 200, updatedAt: 200 }).where(eq(requests.id, gear)).run()

    expect(
      repository.queryRequests({ filters: { query: 'orange', hasNotes: true, hasSource: true, hasThumbnail: true, hasPreview: true } })
        .requests,
    ).toMatchObject([{ id: bracket }])
    expect(repository.queryRequests({ filters: { requester: 'maker', minQuantity: 2, maxQuantity: 4 } }).requests).toMatchObject([
      { id: bracket },
    ])
    expect(repository.queryRequests({ filters: { createdAfter: 150, updatedBefore: 250 } }).requests).toMatchObject([{ id: gear }])
    expect(
      repository.queryRequests({ filters: { hasNotes: false, hasSource: false, hasThumbnail: false, hasPreview: false } }).requests,
    ).toMatchObject([{ id: gear }])
    expect(repository.queryRequests({ filters: { sort: 'name-desc' } }).requests.map((request) => request.name)).toEqual([
      'Gear',
      'Bracket',
    ])
    expect(repository.queryRequests({ filters: { sort: 'quantity-desc' } }).requests.map((request) => request.quantity)).toEqual([3, 1])

    const result = repository.queryRequests({ filters: { requester: 'maker' } })
    expect(result.facets).toMatchObject({ total: 1, available: 2 })
    expect(result.facets.requesters).toEqual([
      { value: 'maker', label: 'Maker', count: 1 },
      { value: 'other', label: 'Other', count: 1 },
    ])
  })

  it('keeps requesters with duplicate display names distinct', () => {
    insertUser(repository, { id: 'alex-1', name: 'Alex', email: 'alex-1@example.com' })
    insertUser(repository, { id: 'alex-2', name: 'Alex', email: 'alex-2@example.com' })
    for (const ownerUserId of ['alex-1', 'alex-2']) {
      repository.createRequest({
        name: ownerUserId,
        fileName: `${ownerUserId}.stl`,
        filePath: `todo/${ownerUserId}.stl`,
        quantity: 1,
        ownerUserId,
      })
    }

    expect(repository.queryRequests().facets.requesters.filter(({ label }) => label === 'Alex')).toEqual([
      { value: 'alex-1', label: 'Alex', count: 1 },
      { value: 'alex-2', label: 'Alex', count: 1 },
    ])
    expect(repository.queryRequests({ filters: { requester: 'alex-2' } }).requests.map(({ ownerUserId }) => ownerUserId)).toEqual([
      'alex-2',
    ])
  })

  it('filters mixed requests by print type and printer assignment', () => {
    const resin = repository.createRequest({
      name: 'Resin model',
      fileName: 'resin.stl',
      filePath: 'todo/resin.stl',
      quantity: 1,
      ownerUserId: 'maker',
      printerId: 'resin-printer',
    })
    const filament = repository.createRequest({
      name: 'Filament model',
      fileName: 'filament.stl',
      filePath: 'todo/filament.stl',
      quantity: 1,
      ownerUserId: 'maker',
      printerId: 'filament-printer',
    })
    const unassigned = repository.createRequest({
      name: 'Unassigned filament model',
      fileName: 'unassigned.stl',
      filePath: 'todo/unassigned.stl',
      quantity: 1,
      ownerUserId: 'maker',
      requestedPrintType: 'filament',
    })

    repository.setSetting('plate-planner-profiles', [
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

    expect(
      repository
        .queryRequests({ filters: { printType: 'filament' } })
        .requests.map(({ id }) => id)
        .sort(),
    ).toEqual([unassigned, filament].sort())
    expect(repository.queryRequests({ filters: { printerId: 'resin-printer' } }).requests.map(({ id }) => id)).toEqual([resin])
    expect(repository.queryRequests({ filters: { printerId: null } }).requests.map(({ id }) => id)).toEqual([unassigned])
  })

  it('applies visibility and ownership before returning requests or facets', () => {
    insertUser(repository, { id: 'me', name: 'Me', email: 'me@example.com' })
    insertUser(repository, { id: 'them', name: 'Them', email: 'them@example.com' })
    repository.createRequest({
      name: 'Mine',
      fileName: 'mine.stl',
      filePath: 'todo/mine.stl',
      quantity: 1,
      ownerUserId: 'me',
    })
    repository.createRequest({
      name: 'Theirs',
      fileName: 'theirs.stl',
      filePath: 'todo/theirs.stl',
      quantity: 1,
      ownerUserId: 'them',
    })
    const privateResult = repository.queryRequests({ visibleToUserId: 'me' })
    expect(privateResult.requests.map((request) => request.name)).toEqual(['Mine'])
    expect(privateResult.facets).toMatchObject({ total: 1, available: 1 })
    expect(repository.queryRequests({ ownerUserId: 'me' }).requests.map((request) => request.name)).toEqual(['Mine'])

    repository.database.update(user).set({ name: 'Renamed' }).where(eq(user.id, 'me')).run()
    expect(repository.queryRequests({ ownerUserId: 'me' }).requests[0]).toMatchObject({ ownerName: 'Renamed' })

    expect(() => repository.database.delete(user).where(eq(user.id, 'me')).run()).toThrow('FOREIGN KEY constraint failed')
    expect(repository.listRequests().find((request) => request.name === 'Mine')).toMatchObject({
      ownerUserId: 'me',
      ownerName: 'Renamed',
    })
  })

  it('only searches private file and email metadata when enabled', () => {
    repository.createRequest({
      name: 'Model',
      fileName: 'private-file.stl',
      filePath: 'todo/model.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    expect(repository.queryRequests({ filters: { query: 'private-file' } }).requests).toHaveLength(0)
    expect(repository.queryRequests({ filters: { query: 'maker@example.com' }, searchPrivateMetadata: true }).requests).toHaveLength(1)
  })

  it('enforces quantity invariants and cascades status deletion', () => {
    const id = repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 2,
      ownerUserId: 'maker',
    })
    repository.moveCopies({ id, from: 'todo', to: 'done', count: 1, filePath: 'todo/gear.stl' })
    expect(() => repository.updateRequest(id, { quantity: 0 })).toThrow()
    repository.updateRequest(id, { quantity: 4, notes: 'four please', sourceUrl: 'https://example.com/gear' })
    expect(repository.getRequest(id)).toMatchObject({
      quantity: 4,
      counts: { todo: 3, done: 1 },
      notes: 'four please',
      sourceUrl: 'https://example.com/gear',
    })
    repository.deleteRequest(id)
    expect(repository.getRequest(id)).toBeUndefined()
  })

  it('cascades completed upload receipts when deleting their request', () => {
    const id = repository.createRequest({
      name: 'Uploaded gear',
      fileName: 'uploaded-gear.stl',
      filePath: 'todo/uploaded-gear.stl',
      quantity: 1,
      ownerUserId: 'owner',
    })
    repository.createUploadSession('completed-upload', 'owner', Date.now() + 60_000, 3)
    repository.database.update(uploadSessions).set({ completedRequestId: id }).where(eq(uploadSessions.id, 'completed-upload')).run()

    repository.deleteRequest(id)

    expect(repository.database.select().from(uploadSessions).where(eq(uploadSessions.id, 'completed-upload')).get()).toBeUndefined()
  })

  it('round-trips JSON settings by key', () => {
    expect(repository.getSetting('storage')).toBeUndefined()
    repository.setSetting('storage', { adapter: 'local', root: '/prints' })
    expect(repository.getSetting('storage')).toEqual({ adapter: 'local', root: '/prints' })
    repository.setSetting('storage', { adapter: 's3', bucket: 'prints' })
    expect(repository.getSetting('storage')).toEqual({ adapter: 's3', bucket: 'prints' })
  })

  it('maintains integrity, exposes database information, and installs the auth limiter table', () => {
    const maintenance = repository.maintain()
    expect(maintenance.integrity).toBe('ok')
    expect(maintenance.checkedAt).toBeGreaterThan(0)
    expect(repository.databaseInfo()).toMatchObject({ path: ':memory:', sizeBytes: 0, integrity: 'ok' })
    expect(repository.database.get<{ journal_mode: string }>(drizzleSql`PRAGMA journal_mode`)?.journal_mode).toBe('memory')
    expect(repository.database.get<{ synchronous: number }>(drizzleSql`PRAGMA synchronous`)?.synchronous).toBe(2)
    expect(repository.database.get<{ foreign_keys: number }>(drizzleSql`PRAGMA foreign_keys`)?.foreign_keys).toBe(1)
    expect(repository.database.get<{ timeout: number }>(drizzleSql`PRAGMA busy_timeout`)?.timeout).toBe(5000)
    expect(repository.database.get(drizzleSql`SELECT name FROM sqlite_master WHERE type='table' AND name='rateLimit'`)).toEqual({
      name: 'rateLimit',
    })
  })

  it('creates a consistent online backup', async () => {
    const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-backup-'))
    const source = path.join(temporary, 'source.sqlite')
    const destination = path.join(temporary, 'backups', 'copy.sqlite')
    const persisted = DrizzleRepository.open(source)
    try {
      insertUser(persisted, { id: 'maker', name: 'Maker', email: 'maker@example.com' })
      const id = persisted.createRequest({
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
        expect(copy.prepare('SELECT name FROM requests WHERE id=?').get(id)).toEqual({ name: 'Backup probe' })
      } finally {
        copy.close()
      }
      expect(persisted.databaseInfo()).toMatchObject({ path: source, integrity: 'ok' })
      expect(persisted.databaseInfo().sizeBytes).toBeGreaterThan(0)
      expect((await fs.promises.readdir(path.dirname(destination))).filter((file) => file.endsWith('.tmp'))).toEqual([])
    } finally {
      persisted.close()
      await fs.promises.rm(temporary, { recursive: true, force: true })
    }
  })

  it('reads users and people from the better-auth user table', () => {
    repository.database.delete(user).run()
    insertUser(repository, { id: 'u1', name: 'Maker', email: 'maker@example.com', color: '#fa0' })
    insertUser(repository, { id: 'u2', name: 'Zed', email: 'zed@example.com', workspaceRole: 'admin' })
    expect(repository.listUsers()).toEqual([
      { id: 'u2', email: 'zed@example.com', name: 'Zed', image: undefined, role: 'admin', workspaceRole: 'admin' },
      { id: 'u1', email: 'maker@example.com', name: 'Maker', image: undefined, role: 'requester', workspaceRole: 'member' },
    ])
    expect(repository.listPeople()).toEqual([
      { id: 'u1', name: 'Maker', color: '#fa0' },
      { id: 'u2', name: 'Zed', color: undefined },
    ])
    expect(repository.countUsers()).toBe(2)
  })

  it('lists accounts independently of workspace membership', () => {
    repository.database.delete(user).run()
    insertUser(repository, { id: 'member', name: 'Workspace Member', email: 'member@example.com' })
    const now = new Date()
    repository.database
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

    expect(repository.listUsers()).toEqual([expect.objectContaining({ id: 'member', workspaceRole: 'member' })])
    expect(repository.listAccounts()).toEqual([
      {
        id: 'super-admin',
        email: 'admin@example.com',
        name: 'Super Admin',
        image: undefined,
        role: 'super_admin',
      },
      {
        id: 'member',
        email: 'member@example.com',
        name: 'Workspace Member',
        image: undefined,
        role: 'requester',
      },
    ])
    expect(repository.accountExists('ADMIN@EXAMPLE.COM')).toBe(true)
    expect(repository.accountExists('missing@example.com')).toBe(false)
  })

  it('isolates workspace requests, printers, invites, uploads, and members', () => {
    const primary = repository.scoped('test-workspace')
    const secondaryWorkspace = repository.createWorkspace({ id: 'owner' }, 'Second farm')
    const secondary = repository.scoped(secondaryWorkspace.id)
    const primaryRequest = primary.createRequest({
      name: 'Primary model',
      fileName: 'primary.stl',
      filePath: 'todo/primary.stl',
      quantity: 1,
      ownerUserId: 'owner',
    })
    const secondaryRequest = secondary.createRequest({
      name: 'Secondary model',
      fileName: 'secondary.stl',
      filePath: 'todo/secondary.stl',
      quantity: 1,
      ownerUserId: 'owner',
    })
    primary.setSetting('board', { privateRequests: true })
    secondary.setSetting('board', { privateRequests: false })
    primary.setSetting('printers', [{ id: 'primary-printer', name: 'Primary printer', printType: 'resin' }])
    secondary.setSetting('printers', [{ id: 'secondary-printer', name: 'Secondary printer', printType: 'filament' }])
    primary.createInvite({ id: 'primary-invite', tokenHash: 'primary-token', role: 'admin', expiresAt: Date.now() + 60_000 })
    secondary.createInvite({ id: 'secondary-invite', tokenHash: 'secondary-token', role: 'requester', expiresAt: Date.now() + 60_000 })
    primary.createUploadSession('primary-upload', 'owner', Date.now() + 60_000, 3)
    secondary.createUploadSession('secondary-upload', 'owner', Date.now() + 60_000, 3)

    expect(primary.getRequest(primaryRequest)).toBeTruthy()
    expect(primary.getRequest(secondaryRequest)).toBeUndefined()
    expect(secondary.getRequest(primaryRequest)).toBeUndefined()
    expect(secondary.getRequest(secondaryRequest)).toBeTruthy()
    expect(primary.getSetting('board')).toEqual({ privateRequests: true })
    expect(secondary.getSetting('board')).toEqual({ privateRequests: false })
    expect(primary.getSetting('printers')).toEqual([{ id: 'primary-printer', name: 'Primary printer', printType: 'resin' }])
    expect(secondary.getSetting('printers')).toEqual([{ id: 'secondary-printer', name: 'Secondary printer', printType: 'filament' }])
    expect(primary.listAssetGenerationJobs().every((job) => job.requestId === primaryRequest)).toBe(true)
    expect(secondary.listAssetGenerationJobs().every((job) => job.requestId === secondaryRequest)).toBe(true)
    expect(primary.listInvites()).toEqual([expect.objectContaining({ id: 'primary-invite' })])
    expect(secondary.listInvites()).toEqual([expect.objectContaining({ id: 'secondary-invite' })])
    expect(primary.findInvite('secondary-token')).toBeUndefined()
    expect(secondary.findInvite('primary-token')).toBeUndefined()
    expect(() =>
      repository.database
        .insert(requestStatuses)
        .values({ workspaceId: 'test-workspace', requestId: secondaryRequest, statusId: 'forged', quantity: 1 })
        .run(),
    ).toThrow(/foreign key constraint failed/i)
    expect(primary.uploadIdsOwnedBy('owner')).toEqual(['primary-upload'])
    expect(secondary.uploadIdsOwnedBy('owner')).toEqual(['secondary-upload'])
    expect(secondary.listUsers()).toEqual([expect.objectContaining({ id: 'owner', workspaceRole: 'owner' })])
  })

  it('rejects cross-workspace operation and upload relationships', () => {
    const primary = repository.scoped('test-workspace')
    const secondaryWorkspace = repository.createWorkspace({ id: 'owner' }, 'Second farm')
    const secondary = repository.scoped(secondaryWorkspace.id)
    const requestId = primary.createRequest({
      name: 'Primary model',
      fileName: 'primary.stl',
      filePath: 'todo/primary.stl',
      quantity: 1,
      ownerUserId: 'owner',
    })
    primary.createUploadSession('primary-upload', 'owner', Date.now() + 60_000, 3)
    secondary.createUploadSession('secondary-upload', 'owner', Date.now() + 60_000, 3)

    expect(() => secondary.beginOperation(crypto.randomUUID(), { kind: 'delete', requestId, assets: [] })).toThrow(
      expect.objectContaining({ status: 404 }),
    )
    expect(() =>
      secondary.beginUploadOperation(crypto.randomUUID(), {
        kind: 'upload',
        uploadId: 'primary-upload',
        ownerId: 'owner',
        requestId: crypto.randomUUID(),
        partPath: 'uploads/primary-upload.part',
        destinationPath: 'todo/model.stl',
        request: { name: 'Model', fileName: 'model.stl', quantity: 1, ownerUserId: 'owner' },
      }),
    ).toThrow(expect.objectContaining({ status: 404 }))
    expect(() =>
      repository.database
        .update(uploadSessions)
        .set({ completedRequestId: requestId })
        .where(and(eq(uploadSessions.workspaceId, secondaryWorkspace.id), eq(uploadSessions.id, 'secondary-upload')))
        .run(),
    ).toThrow('FOREIGN KEY constraint failed')
  })

  it('allows matching workspace names for different owners only', () => {
    const first = repository.createWorkspace({ id: 'owner' }, 'Test farm')
    const second = repository.createWorkspace({ id: 'other' }, 'test farm')

    expect(first.slug).toBe('test-farm')
    expect(second.slug).toBe('test-farm-2')
    expect(() => repository.createWorkspace({ id: 'owner' }, '  TEST FARM  ')).toThrow(expect.objectContaining({ status: 409 }))
  })

  it('provisions one personal workspace per membershipless user', () => {
    const now = new Date()
    repository.database
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
    repository.addWorkspaceMember('personal-owner', 'member')
    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const first = repository.ensurePersonalWorkspace({ id: 'personal-owner', name: 'Personal Owner' })
      const second = repository.ensurePersonalWorkspace({ id: 'personal-owner', name: 'Personal Owner' })

      expect(second).toEqual(first)
      expect(repository.listWorkspacesForUser('personal-owner')).toEqual([
        expect.objectContaining({ id: first.id, role: 'owner' }),
        expect.objectContaining({ id: 'test-workspace', role: 'member' }),
      ])
    } finally {
      process.env.NODE_ENV = previousNodeEnv
    }
  })

  it('lets an existing matching account accept an emailed invite exactly once', () => {
    const now = new Date()
    repository.database
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
    repository.createInvite({
      id: 'emailed-invite',
      tokenHash: 'emailed-token',
      role: 'admin',
      recipientEmail: 'invitee@example.com',
      expiresAt: Date.now() + 60_000,
    })

    expect(repository.acceptInviteForUser('emailed-token', Date.now(), { id: 'invitee', email: 'invitee@example.com' })).toBeTruthy()
    expect(repository.acceptInviteForUser('emailed-token', Date.now(), { id: 'invitee', email: 'invitee@example.com' })).toBeUndefined()
    expect(repository.workspaceSlugForInvite('emailed-token', Date.now())).toBe('test-workspace')
    expect(repository.listWorkspacesForUser('invitee')).toEqual([expect.objectContaining({ id: 'test-workspace', role: 'admin' })])
  })

  it('keeps an emailed invite usable after the wrong account tries to accept it', () => {
    const expiresAt = Date.now() + 60_000
    repository.createInvite({
      id: 'bound-invite',
      tokenHash: 'bound-token',
      role: 'requester',
      recipientEmail: 'right@example.com',
      expiresAt,
    })

    expect(() => repository.acceptInviteForUser('bound-token', Date.now(), { id: 'wrong-user', email: 'wrong@example.com' })).toThrow(
      expect.objectContaining({ status: 403 }),
    )
    expect(repository.findInvite('bound-token')).toMatchObject({ usedAt: undefined })
    expect(repository.workspaceSlugForInvite('bound-token', Date.now())).toBe('test-workspace')
  })

  it('persists operation state transitions with the associated metadata commit', () => {
    const id = repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    const operationId = crypto.randomUUID()
    repository.beginOperation(operationId, {
      kind: 'move',
      requestId: id,
      fromStatus: 'todo',
      toStatus: 'done',
      count: 1,
      sourcePath: 'todo/gear.stl',
      destinationPath: 'done/gear.stl',
    })
    repository.markOperationAssetsMoved(operationId)
    repository.completeMoveOperation(operationId, { id, from: 'todo', to: 'done', count: 1, filePath: 'done/gear.stl' })
    expect(repository.getRequest(id)).toMatchObject({ counts: { todo: 0, done: 1 }, filePath: 'done/gear.stl' })
    expect(repository.listOperations()).toMatchObject([{ id: operationId, state: 'committed' }])
    repository.finishOperation(operationId)
    expect(repository.listOperations()).toHaveLength(0)
  })

  it('preserves requester priority when moving between statuses', () => {
    const id = repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    repository.reorderRequest(id, 4)
    repository.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1, filePath: 'in-progress/gear.stl', order: 4 })
    repository.moveCopies({ id, from: 'in_progress', to: 'todo', count: 1, filePath: 'todo/gear.stl', order: 2 })
    repository.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1, filePath: 'in-progress/gear.stl', order: 9 })
    expect(repository.getRequest(id)?.orders).toMatchObject({ todo: 4, in_progress: 4 })
  })

  it('tracks when a request most recently entered the completed status', () => {
    const id = repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })

    repository.moveCopies({ id, from: 'todo', to: 'done', count: 1, filePath: 'done/gear.stl', movedAt: 100 })
    expect(repository.getRequest(id)?.completedAt).toBe(100)
    repository.moveCopies({ id, from: 'done', to: 'todo', count: 1, filePath: 'todo/gear.stl', movedAt: 200 })
    expect(repository.getRequest(id)?.completedAt).toBeUndefined()
    repository.moveCopies({ id, from: 'todo', to: 'done', count: 1, filePath: 'done/gear.stl', movedAt: 300 })
    expect(repository.getRequest(id)?.completedAt).toBe(300)
  })

  it('records every migration for fresh databases', () => {
    const database = new Database(':memory:')
    const migrated = new DrizzleRepository(createDatabase(database))

    expect(database.prepare('SELECT count(*) count FROM __drizzle_migrations').get()).toEqual({ count: 11 })
    migrated.close()
  })

  it('renames only the untouched legacy workspace display name', () => {
    const database = new Database(':memory:')
    database.exec(`
      CREATE TABLE organization (id text PRIMARY KEY NOT NULL, name text NOT NULL, slug text NOT NULL);
      CREATE TABLE requests (id text PRIMARY KEY NOT NULL, thumbnail_path text, preview_path text);
      CREATE TABLE operations (id text PRIMARY KEY NOT NULL, payload_json text NOT NULL);
      INSERT INTO organization VALUES ('legacy-workspace', 'PrintHub', 'printhub');
      INSERT INTO organization VALUES ('custom-workspace', 'PrintHub', 'custom');
      INSERT INTO requests VALUES ('request', '.printhub/thumbnails/model.png', '.printhub/previews/model.phm');
      INSERT INTO operations VALUES ('operation', '{"trashPath":".printhub/trash/model.stl"}');
    `)
    const migration = fs
      .readFileSync(path.resolve('drizzle/0010_rename_legacy_workspace.sql'), 'utf8')
      .replaceAll('--> statement-breakpoint', '')

    database.exec(migration)

    expect({
      organizations: database.prepare('SELECT id, name, slug FROM organization ORDER BY id').all(),
      request: database.prepare('SELECT thumbnail_path, preview_path FROM requests').get(),
      operation: database.prepare('SELECT payload_json FROM operations').get(),
    }).toEqual({
      organizations: [
        { id: 'custom-workspace', name: 'PrintHub', slug: 'custom' },
        { id: 'legacy-workspace', name: 'STL Quest', slug: 'printhub' },
      ],
      request: { thumbnail_path: '.stlquest/thumbnails/model.png', preview_path: '.stlquest/previews/model.phm' },
      operation: { payload_json: '{"trashPath":".stlquest/trash/model.stl"}' },
    })
    database.close()
  })

  it('renames the legacy global admin role without changing workspace roles', () => {
    const database = new Database(':memory:')
    database.exec(`
      CREATE TABLE user (id text PRIMARY KEY NOT NULL, role text);
      CREATE TABLE member (id text PRIMARY KEY NOT NULL, role text NOT NULL);
      INSERT INTO user VALUES ('operator', 'admin'), ('requester', 'requester');
      INSERT INTO member VALUES ('workspace-admin', 'admin');
    `)
    const migration = fs.readFileSync(path.resolve('drizzle/0008_rename_super_admin_role.sql'), 'utf8')

    database.exec(migration)

    expect(database.prepare('SELECT id, role FROM user ORDER BY id').all()).toEqual([
      { id: 'operator', role: 'super_admin' },
      { id: 'requester', role: 'requester' },
    ])
    expect(database.prepare('SELECT role FROM member').get()).toEqual({ role: 'admin' })
    database.close()
  })

  it('clears legacy upload completions that cross workspace boundaries', () => {
    const database = new Database(':memory:')
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE organization (id text PRIMARY KEY NOT NULL);
      CREATE TABLE user (id text PRIMARY KEY NOT NULL);
      CREATE TABLE requests (
        id text PRIMARY KEY NOT NULL,
        workspace_id text NOT NULL,
        UNIQUE(workspace_id, id)
      );
      CREATE TABLE upload_sessions (
        id text PRIMARY KEY NOT NULL,
        workspace_id text NOT NULL REFERENCES organization(id),
        owner_id text NOT NULL REFERENCES user(id),
        bytes integer DEFAULT 0 NOT NULL,
        expires_at integer NOT NULL,
        completed_request_id text REFERENCES requests(id)
      );
      CREATE TABLE operations (workspace_id text NOT NULL, request_id text, upload_id text, state text NOT NULL);
      CREATE UNIQUE INDEX operations_active_request ON operations(request_id) WHERE request_id IS NOT NULL AND state <> 'committed';
      CREATE UNIQUE INDEX operations_upload ON operations(upload_id) WHERE upload_id IS NOT NULL;
      INSERT INTO organization VALUES ('workspace-a'), ('workspace-b');
      INSERT INTO user VALUES ('owner');
      INSERT INTO requests VALUES ('request-a', 'workspace-a');
      INSERT INTO upload_sessions VALUES ('upload-b', 'workspace-b', 'owner', 1, 1, 'request-a');
    `)
    const migration = fs.readFileSync(path.resolve('drizzle/0007_conscious_whizzer.sql'), 'utf8').replaceAll('--> statement-breakpoint', '')

    database.exec(migration)

    expect(database.prepare('SELECT completed_request_id FROM upload_sessions WHERE id = ?').get('upload-b')).toEqual({
      completed_request_id: null,
    })
    expect(database.pragma('foreign_key_check')).toEqual([])
    database.close()
  })

  it('migrates legacy printer settings and preserves existing assignments', () => {
    const printer: PrinterProfile = { id: 'paused-filament', name: 'Paused filament printer', printType: 'filament' }
    repository.setSetting('plate-planner-profiles', [{ ...printer, widthMm: 220 }])
    repository.setSetting('plate-planner-drafts', { legacy: true })
    const request = repository.createRequest({
      name: 'Assigned model',
      fileName: 'assigned.stl',
      filePath: 'todo/assigned.stl',
      quantity: 1,
      ownerUserId: 'maker',
      printerId: printer.id,
    })

    repository.replacePrinterProfiles([printer])

    expect(repository.getRequest(request)).toMatchObject({ printerId: printer.id, requestedPrintType: undefined })
    expect(repository.getSetting('printers')).toEqual([printer])
    expect(repository.getSetting('plate-planner-profiles')).toBeUndefined()
    expect(repository.getSetting('plate-planner-drafts')).toBeUndefined()
  })

  it('moves requests from a deleted printer into its same-type pool', () => {
    const printer: PrinterProfile = {
      id: 'retired-filament',
      name: 'Retired filament printer',
      printType: 'filament',
    }
    repository.setSetting('printers', [printer])
    const request = repository.createRequest({
      name: 'Assigned model',
      fileName: 'assigned.stl',
      filePath: 'todo/assigned.stl',
      quantity: 1,
      ownerUserId: 'maker',
      printerId: printer.id,
    })

    repository.replacePrinterProfiles([])

    expect(repository.getRequest(request)).toMatchObject({ printerId: undefined, requestedPrintType: 'filament' })
  })

  it('assigns existing pooled requests when printer settings are saved', () => {
    const request = repository.createRequest({
      name: 'Pooled model',
      fileName: 'pooled.stl',
      filePath: 'todo/pooled.stl',
      quantity: 1,
      ownerUserId: 'maker',
      requestedPrintType: 'resin',
    })

    repository.replacePrinterProfiles([{ id: 'small', name: 'Small', printType: 'resin', widthMm: 100, depthMm: 100 }])

    expect(repository.getRequest(request)).toMatchObject({
      printerId: 'small',
      requestedPrintType: undefined,
      automaticPrinterAssignment: true,
    })
  })

  it('persists predefined printer matches by name when the repository starts', () => {
    repository.setSetting('printers', [
      {
        id: 'mars-2',
        name: 'Elegoo Mars 2',
        printType: 'resin',
        widthMm: 100,
        depthMm: 100,
      },
    ])

    const reopened = new DrizzleRepository(repository.database, { ownsDatabase: false })

    expect(repository.getSetting<PrinterProfile[]>('printers')?.[0]?.presetId).toBe('resin-elegoo-mars-2')
    reopened.close()
  })

  it('assigns measured pooled requests only to printers that fit', () => {
    const request = repository.createRequest({
      name: 'Large pooled model',
      fileName: 'large-pooled.stl',
      filePath: 'todo/large-pooled.stl',
      quantity: 1,
      ownerUserId: 'maker',
      requestedPrintType: 'resin',
    })
    repository.setModelDimensions(request, { widthMm: 150, depthMm: 80, heightMm: 120 })

    repository.replacePrinterProfiles([
      { id: 'small', name: 'Small', printType: 'resin', widthMm: 100, depthMm: 100, heightMm: 100 },
      { id: 'large', name: 'Large', printType: 'resin', widthMm: 200, depthMm: 200, heightMm: 200 },
    ])

    expect(repository.getRequest(request)).toMatchObject({ printerId: 'large', automaticPrinterAssignment: true })
  })

  it('backfills existing pooled requests when the repository starts', () => {
    repository.setSetting('printers', [
      { id: 'small', name: 'Small', printType: 'resin', widthMm: 100, depthMm: 100 },
      { id: 'large', name: 'Large', printType: 'resin', widthMm: 200, depthMm: 200 },
    ])
    for (const printerId of ['small', 'large']) {
      repository.createRequest({
        name: `${printerId} workload`,
        fileName: `${printerId}.stl`,
        filePath: `todo/${printerId}.stl`,
        quantity: 1,
        ownerUserId: 'maker',
        printerId,
      })
    }
    const pooled = repository.createRequest({
      name: 'Existing pooled model',
      fileName: 'existing-pooled.stl',
      filePath: 'todo/existing-pooled.stl',
      quantity: 1,
      ownerUserId: 'maker',
      requestedPrintType: 'resin',
    })

    const reopened = new DrizzleRepository(repository.database, { ownsDatabase: false })

    expect(repository.getRequest(pooled)).toMatchObject({ printerId: 'large', requestedPrintType: undefined })
    reopened.close()
  })

  it('does not rewrite unchanged automatic printer assignments when the repository reopens', () => {
    repository.setSetting('printers', [{ id: 'small', name: 'Small', printType: 'resin' }])
    const request = repository.createRequest({
      name: 'Already assigned model',
      fileName: 'already-assigned.stl',
      filePath: 'todo/already-assigned.stl',
      quantity: 1,
      ownerUserId: 'maker',
      printerId: 'small',
      automaticPrinterAssignment: true,
    })
    repository.database.update(requests).set({ updatedAt: 123 }).where(eq(requests.id, request)).run()

    const reopened = new DrizzleRepository(repository.database, { ownsDatabase: false })

    expect(repository.getRequest(request)).toMatchObject({ printerId: 'small', updatedAt: 123 })
    reopened.close()
  })

  it('repairs stale automatic printer assignments when the repository reopens', () => {
    repository.setSetting('printers', [
      { id: 'small', name: 'Small', printType: 'resin' },
      { id: 'large', name: 'Large', printType: 'resin' },
    ])
    repository.createRequest({
      name: 'Small printer workload',
      fileName: 'small-workload.stl',
      filePath: 'todo/small-workload.stl',
      quantity: 1,
      ownerUserId: 'maker',
      printerId: 'small',
    })
    const request = repository.createRequest({
      name: 'Stale assignment',
      fileName: 'stale-assignment.stl',
      filePath: 'todo/stale-assignment.stl',
      quantity: 1,
      ownerUserId: 'maker',
      printerId: 'small',
      automaticPrinterAssignment: true,
    })
    repository.database.update(requests).set({ updatedAt: 123 }).where(eq(requests.id, request)).run()

    const reopened = new DrizzleRepository(repository.database, { ownsDatabase: false })

    expect(repository.getRequest(request)).toMatchObject({ printerId: 'large' })
    expect(repository.getRequest(request)?.updatedAt).not.toBe(123)
    reopened.close()
  })

  it('reconciles added statuses and rejects removed statuses that contain copies', () => {
    const id = repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    repository.database
      .delete(requestStatuses)
      .where(
        and(eq(requestStatuses.workspaceId, 'test-workspace'), eq(requestStatuses.requestId, id), eq(requestStatuses.statusId, 'up_next')),
      )
      .run()
    repository.reconcileWorkflow()
    expect(repository.getRequest(id)?.counts.up_next).toBe(0)
    repository.database
      .insert(requestStatuses)
      .values({ workspaceId: 'test-workspace', requestId: id, statusId: 'retired', quantity: 1 })
      .run()
    expect(() => repository.reconcileWorkflow()).toThrow('still has copies')
  })

  it('persists incomplete-upload ownership, quotas, and completion receipts', () => {
    const expires = Date.now() + 60_000
    expect(repository.createUploadSession('persisted-upload-id', 'owner', expires, 3)).toEqual({ fresh: true })
    expect(repository.reserveUpload('persisted-upload-id', 'owner', 60, expires, { count: 2, bytes: 100 })).toBe(true)
    repository.createUploadSession('second-upload-id', 'owner', expires, 3)
    expect(repository.reserveUpload('second-upload-id', 'owner', 41, expires, { count: 2, bytes: 100 })).toBe(false)
    expect(() => repository.createUploadSession('persisted-upload-id', 'attacker', expires, 3)).toThrow(
      expect.objectContaining({ status: 409 }),
    )
    expect(() => repository.database.delete(user).where(eq(user.id, 'owner')).run()).toThrow('FOREIGN KEY constraint failed')
  })

  it('atomically reserves a request against overlapping durable operations', () => {
    const id = repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    repository.beginOperation(crypto.randomUUID(), {
      kind: 'move',
      requestId: id,
      fromStatus: 'todo',
      toStatus: 'done',
      count: 1,
      sourcePath: 'todo/gear.stl',
      destinationPath: 'done/gear.stl',
    })
    expect(() => repository.beginOperation(crypto.randomUUID(), { kind: 'delete', requestId: id, assets: [] })).toThrow(
      expect.objectContaining({ status: 409 }),
    )
    expect(() => repository.updateRequest(id, { quantity: 2 })).toThrow(expect.objectContaining({ status: 409 }))
    expect(repository.getRequest(id)).toMatchObject({ quantity: 1, filePath: 'todo/gear.stl' })
  })

  it('rejects move completion arguments that differ from the stored operation payload', () => {
    const requestId = repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    const otherRequestId = repository.createRequest({
      name: 'Bracket',
      fileName: 'bracket.stl',
      filePath: 'todo/bracket.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    const operationId = crypto.randomUUID()
    repository.beginOperation(operationId, {
      kind: 'move',
      requestId,
      fromStatus: 'todo',
      toStatus: 'done',
      count: 1,
      sourcePath: 'todo/gear.stl',
      destinationPath: 'done/gear.stl',
    })
    repository.markOperationAssetsMoved(operationId)

    expect(() =>
      repository.completeMoveOperation(operationId, {
        id: otherRequestId,
        from: 'todo',
        to: 'done',
        count: 1,
        filePath: 'done/bracket.stl',
      }),
    ).toThrow('operation payload mismatch')
    expect(repository.getRequest(requestId)).toMatchObject({ counts: { todo: 1, done: 0 }, filePath: 'todo/gear.stl' })
    expect(repository.getRequest(otherRequestId)).toMatchObject({ counts: { todo: 1, done: 0 }, filePath: 'todo/bracket.stl' })
    expect(repository.listOperations()).toMatchObject([{ id: operationId, state: 'assets_moved' }])
  })

  it('rejects delete completion for a different request or operation kind', () => {
    const requestId = repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    const otherRequestId = repository.createRequest({
      name: 'Bracket',
      fileName: 'bracket.stl',
      filePath: 'todo/bracket.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    const deleteOperationId = crypto.randomUUID()
    repository.beginOperation(deleteOperationId, { kind: 'delete', requestId, assets: [] })

    expect(() => repository.completeDeleteOperation(deleteOperationId, otherRequestId)).toThrow('operation payload mismatch')
    expect(repository.getRequest(requestId)).toBeDefined()
    expect(repository.getRequest(otherRequestId)).toBeDefined()
    expect(repository.listOperations()).toMatchObject([{ id: deleteOperationId, state: 'prepared' }])

    const moveOperationId = crypto.randomUUID()
    repository.abandonOperation(deleteOperationId)
    repository.beginOperation(moveOperationId, {
      kind: 'move',
      requestId,
      fromStatus: 'todo',
      toStatus: 'done',
      count: 1,
      sourcePath: 'todo/gear.stl',
      destinationPath: 'done/gear.stl',
    })
    expect(() => repository.completeDeleteOperation(moveOperationId, requestId)).toThrow('operation kind mismatch')
    expect(repository.getRequest(requestId)).toBeDefined()
  })

  it('rejects upload completion data that differs from the stored operation payload', () => {
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
    repository.createUploadSession(payload.uploadId, payload.ownerId, Date.now() + 60_000, 3)
    repository.beginUploadOperation(operationId, payload)

    expect(() => repository.completeUploadOperation(operationId, { ...payload, requestId: crypto.randomUUID() })).toThrow(
      'operation payload mismatch',
    )
    expect(repository.getRequest(payload.requestId)).toBeUndefined()
    expect(repository.getCompletedUpload(payload.uploadId, payload.ownerId)).toBeUndefined()
    expect(repository.listOperations()).toMatchObject([{ id: operationId, state: 'prepared', payload }])
  })

  it('does not persist a newly rejected upload session', () => {
    const expires = Date.now() + 60_000
    for (const id of ['quota-upload-one', 'quota-upload-two', 'quota-upload-three']) {
      expect(repository.createUploadSession(id, 'owner', expires, 3)).toEqual({ fresh: true })
      expect(repository.reserveUpload(id, 'owner', 1, expires, { count: 3, bytes: 100 })).toBe(true)
    }
    expect(() => repository.createUploadSession('quota-upload-four', 'owner', expires, 3)).toThrow(expect.objectContaining({ status: 429 }))
    expect(
      repository.database.select({ count: count() }).from(uploadSessions).where(eq(uploadSessions.ownerId, 'owner')).get()?.count,
    ).toBe(3)
    repository.expireUploads(expires + 1)
    expect(repository.createUploadSession('quota-upload-four', 'owner', expires + 60_000, 3)).toEqual({ fresh: true })
  })

  it('does not let rejected upload creations consume future quota', () => {
    const expires = Date.now() + 60_000
    for (const id of ['rejected-upload-one', 'rejected-upload-two', 'rejected-upload-three']) {
      repository.createUploadSession(id, 'owner', expires, 3)
      expect(repository.reserveUpload(id, 'owner', 101, expires, { count: 3, bytes: 100 })).toBe(false)
    }
    expect(repository.createUploadSession('accepted-upload', 'owner', expires, 3)).toEqual({ fresh: true })
    expect(repository.reserveUpload('accepted-upload', 'owner', 100, expires, { count: 3, bytes: 100 })).toBe(true)
    expect(repository.incompleteUploadStats(Date.now())).toEqual({ count: 1, bytes: 100 })
  })

  it('enforces incomplete-upload quotas after reopening the database', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-sqlite-'))
    const file = path.join(directory, 'test.sqlite')
    const expires = Date.now() + 60_000
    const first = DrizzleRepository.open(file)
    insertUser(first, { id: 'owner', name: 'Owner', email: 'owner@example.com' })
    first.createUploadSession('restart-upload-one', 'owner', expires, 3)
    expect(first.reserveUpload('restart-upload-one', 'owner', 70, expires, { count: 2, bytes: 100 })).toBe(true)
    first.createUploadSession('restart-upload-two', 'owner', expires, 2)
    expect(first.reserveUpload('restart-upload-two', 'owner', 30, expires, { count: 2, bytes: 100 })).toBe(true)
    expect(() => first.createUploadSession('restart-upload-rejected', 'owner', expires, 2)).toThrow(
      expect.objectContaining({ status: 429 }),
    )
    first.close()
    const reopened = DrizzleRepository.open(file)
    expect(reopened.reserveUpload('restart-upload-two', 'owner', 31, expires, { count: 2, bytes: 100 })).toBe(false)
    expect(reopened.createUploadSession('restart-upload-one', 'owner', expires, 2)).toEqual({ fresh: false })
    expect(() => reopened.createUploadSession('restart-upload-rejected', 'owner', expires, 2)).toThrow(
      expect.objectContaining({ status: 429 }),
    )
    reopened.close()
    await fs.promises.rm(directory, { recursive: true, force: true })
  })
})

describe('databasePath', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('uses the STL Quest database name for new data directories', async () => {
    const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-database-'))
    vi.stubEnv('DATA_DIR', temporary)

    expect(databasePath()).toBe(path.join(temporary, 'stlquest.sqlite'))
  })
})
