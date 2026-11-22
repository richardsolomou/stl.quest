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
import { MAX_WORKSPACE_NAME_LENGTH } from '../core/workspaces'
import type { UsageEvent } from '../core/usage'
import type { Consumable } from '../core/consumables'
import type { EquipmentItem } from '../core/equipment'
import type { InventoryItems, InventoryKind } from '../core/inventory'
import {
  account,
  assetGenerationJobs,
  organization,
  printGroups,
  requests,
  requestStatuses,
  session,
  subscription,
  uploadSessions,
  user,
} from './schema'

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

async function stock<Kind extends InventoryKind>(
  repository: Pick<DrizzleRepository, 'changeInventory'>,
  kind: Kind,
  items: InventoryItems[Kind][],
) {
  await repository.changeInventory(kind, (current) => [...current, ...items])
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

  it('keeps Spoolman spools until the workspace disconnects', async () => {
    const spool = { id: 1, filamentId: 10, material: 'PLA', remainingGrams: 600, archived: true }
    await repository.connectSpoolman('hash', 1)
    await repository.receiveSpoolman({ replace: [spool] }, 2, 10)
    await repository.receiveSpoolman({ upsert: { ...spool, id: 2, archived: false } }, 3, 10)
    // PostgreSQL stores the flag as an integer, so it is read for truthiness, as stock reads it.
    expect((await repository.listSpoolmanSpools()).map(({ id, archived }) => [id, archived ? 'archived' : 'in use'])).toEqual([
      [1, 'archived'],
      [2, 'in use'],
    ])
    await repository.disconnectSpoolman()
    expect(await repository.listSpoolmanSpools()).toEqual([])
  })

  it('finds the workspace of a Spoolman token only by its hash', async () => {
    await repository.connectSpoolman('hash', 1)
    expect([(await repository.workspaceForSpoolmanToken('hash'))?.id, await repository.workspaceForSpoolmanToken('other')]).toEqual([
      'test-workspace',
      undefined,
    ])
  })

  it('drops a Spoolman link when its filament is deleted', async () => {
    await stock(repository, 'consumables', [{ id: 'pla', kind: 'filament', name: 'PLA', pricePerKg: 20, archived: true }])
    await repository.setSpoolmanLink(10, { consumableId: 'pla' }, 1)
    await repository.deleteInventoryItem('consumables', 'pla', () => undefined)
    expect(await repository.listSpoolmanLinks()).toEqual([])
  })

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

  it('numbers requests one after another', async () => {
    const model = { name: 'Model', fileName: 'model.stl', filePath: 'todo/model.stl', quantity: 1, ownerUserId: 'maker' }
    const first = await repository.createRequest(model)
    const second = await repository.createRequest(model)

    expect([(await repository.getRequest(first))?.number, (await repository.getRequest(second))?.number]).toEqual([1, 2])
  })

  it('numbers concurrently created requests apart', async () => {
    const model = { name: 'Model', fileName: 'model.stl', filePath: 'todo/model.stl', quantity: 1, ownerUserId: 'maker' }
    await Promise.all([repository.createRequest(model), repository.createRequest(model), repository.createRequest(model)])

    expect((await repository.listRequests()).map(({ number }) => number).sort((left, right) => left - right)).toEqual([1, 2, 3])
  })

  it('never reuses the number of a deleted request', async () => {
    const model = { name: 'Model', fileName: 'model.stl', filePath: 'todo/model.stl', quantity: 1, ownerUserId: 'maker' }
    await repository.createRequest(model)
    await repository.deleteRequest(await repository.createRequest(model))

    expect((await repository.getRequest(await repository.createRequest(model)))?.number).toBe(3)
  })

  it('numbers requests that were stored without one before the next request', async () => {
    const model = { name: 'Model', fileName: 'model.stl', filePath: 'todo/model.stl', quantity: 1, ownerUserId: 'maker' }
    const first = await repository.createRequest(model)
    const unnumbered = await repository.createRequest(model)
    await repository.database.update(requests).set({ number: null }).where(eq(requests.id, unnumbered)).run()
    const next = await repository.createRequest(model)

    expect(await Promise.all([first, unnumbered, next].map(async (id) => (await repository.getRequest(id))?.number))).toEqual([1, 3, 4])
  })

  it("numbers each workspace's requests on their own", async () => {
    const model = { name: 'Model', fileName: 'model.stl', filePath: 'todo/model.stl', quantity: 1, ownerUserId: 'maker' }
    await repository.createRequest(model)
    const other = await repository.scoped((await repository.createWorkspace({ id: 'owner' }, 'Second farm')).id)

    expect((await other.getRequest(await other.createRequest(model)))?.number).toBe(1)
  })

  it('persists requests and tracks copy quantities transactionally', async () => {
    await stock(repository, 'printers', [
      { id: 'printer-id', name: 'Saturn', printType: 'resin' },
      { id: 'next-printer', name: 'Mars', printType: 'resin' },
    ])
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
    await expect(repository.moveCopies({ id, from: 'todo', to: 'done', count: 2, filePath: 'todo/bracket.stl' })).rejects.toMatchObject({
      status: 409,
    })
    expect((await repository.getRequest(id))?.counts).toEqual({ todo: 1, up_next: 0, in_progress: 2, post_processing: 0, done: 0 })
  })

  it('persists linked requests without asset generation jobs', async () => {
    const id = await repository.createRequest({
      name: 'MakerWorld bookmark',
      quantity: 1,
      ownerUserId: 'maker',
      sourceUrl: 'https://makerworld.com/models/bookmark',
      sourceImageUrl: 'https://makerworld.bblmw.com/bookmark.png',
      requestedPrintType: 'filament',
    })

    expect(await repository.getRequest(id)).toMatchObject({
      fileName: undefined,
      filePath: undefined,
      sourceUrl: 'https://makerworld.com/models/bookmark',
      sourceImageUrl: 'https://makerworld.bblmw.com/bookmark.png',
    })
    expect(await repository.assetGenerationJobs(id)).toEqual([])
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

  it('tracks estimate geometry, thumbnail, and preview generation as durable stages', async () => {
    const id = await repository.createRequest({
      name: 'Stages',
      fileName: 'stages.stl',
      filePath: 'todo/stages.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    expect(await repository.assetGenerationJobs(id)).toEqual([
      expect.objectContaining({ stage: 'geometry', status: 'pending' }),
      expect.objectContaining({ stage: 'preview', status: 'pending' }),
      expect.objectContaining({ stage: 'thumbnail', status: 'pending' }),
    ])
    await repository.startAssetGeneration(id, ['geometry', 'thumbnail', 'preview'])
    await repository.finishAssetGeneration(id, 'geometry', { status: 'ready' })
    await repository.finishAssetGeneration(id, 'thumbnail', { status: 'ready', path: 'thumbnails/stages.png' })
    await repository.finishAssetGeneration(id, 'preview', { status: 'skipped' })
    expect(await repository.assetGenerationJobs(id)).toEqual([
      expect.objectContaining({ stage: 'geometry', status: 'ready' }),
      expect.objectContaining({ stage: 'preview', status: 'skipped' }),
      expect.objectContaining({ stage: 'thumbnail', status: 'ready' }),
    ])
    expect(await repository.requestsNeedingAssets()).toEqual([])
  })

  it('requeues failed stages by failure kind, not by their error text', async () => {
    const id = await repository.createRequest({
      name: 'Failures',
      fileName: 'failures.stl',
      filePath: 'todo/failures.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    await repository.startAssetGeneration(id, ['geometry', 'thumbnail', 'preview'])
    await repository.finishAssetGeneration(id, 'geometry', { status: 'failed', error: 'storage busy', failureKind: 'storage' })
    await repository.finishAssetGeneration(id, 'thumbnail', {
      status: 'failed',
      error: 'Storage kept failing: storage busy',
      failureKind: 'permanent',
    })
    await repository.finishAssetGeneration(id, 'preview', { status: 'failed', error: 'asset missing', failureKind: 'permanent' })
    await repository.requeueStorageFailedAssetGeneration()
    expect((await repository.assetGenerationJobs(id)).map(({ stage, status, failureKind }) => ({ stage, status, failureKind }))).toEqual([
      { stage: 'geometry', status: 'pending', failureKind: undefined },
      { stage: 'preview', status: 'failed', failureKind: 'permanent' },
      { stage: 'thumbnail', status: 'failed', failureKind: 'permanent' },
    ])
  })

  it('lists storage-failed requests oldest failure first, up to the limit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const failed: string[] = []
    try {
      for (const name of ['First', 'Second', 'Third']) {
        const id = await repository.createRequest({
          name,
          fileName: `${name}.stl`,
          filePath: `todo/${name}.stl`,
          quantity: 1,
          ownerUserId: 'maker',
        })
        await repository.startAssetGeneration(id, ['thumbnail'])
        vi.advanceTimersByTime(1_000)
        await repository.finishAssetGeneration(id, 'thumbnail', { status: 'failed', error: 'storage busy', failureKind: 'storage' })
        failed.push(id)
      }
    } finally {
      vi.useRealTimers()
    }
    expect(await repository.storageFailedAssetGenerationRequests(2)).toEqual(failed.slice(0, 2))
  })

  it('requeues storage failures only for the given requests', async () => {
    const ids = await Promise.all(
      ['Kept', 'Requeued'].map(async (name) => {
        const id = await repository.createRequest({
          name,
          fileName: `${name}.stl`,
          filePath: `todo/${name}.stl`,
          quantity: 1,
          ownerUserId: 'maker',
        })
        await repository.startAssetGeneration(id, ['thumbnail'])
        await repository.finishAssetGeneration(id, 'thumbnail', { status: 'failed', error: 'storage busy', failureKind: 'storage' })
        return id
      }),
    )
    await repository.requeueStorageFailedAssetGeneration([ids[1]])
    expect(await repository.storageFailedAssetGenerationRequests(10)).toEqual([ids[0]])
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
    await repository.startAssetGeneration(id, ['geometry', 'thumbnail', 'preview'])
    await repository.finishAssetGeneration(id, 'geometry', { status: 'ready' })
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

  it('excludes archived requests from queries until asked and restores them', async () => {
    const kept = await repository.createRequest({
      name: 'Kept',
      fileName: 'kept.stl',
      filePath: 'todo/kept.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    const archived = await repository.createRequest({
      name: 'Archived',
      fileName: 'archived.stl',
      filePath: 'todo/archived.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })

    await repository.setRequestsArchived([archived, kept], 500)
    await repository.setRequestsArchived([kept], null)

    expect((await repository.queryRequests()).requests.map(({ id }) => id)).toEqual([kept])
    expect((await repository.queryRequests({ filters: { archived: true } })).requests.map(({ id }) => id)).toEqual([archived])
    expect((await repository.queryRequests({ includeArchived: true })).requests.map(({ id }) => id).sort()).toEqual([archived, kept].sort())
    expect(await repository.getRequest(archived)).toMatchObject({ archivedAt: 500 })
    expect(await repository.getRequest(kept)).toMatchObject({ archivedAt: undefined })
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
    await stock(repository, 'printers', [
      {
        id: 'resin-printer',
        name: 'Resin printer',
        printType: 'resin',
        widthMm: 100,
        depthMm: 60,
        heightMm: 150,
      },
      {
        id: 'filament-printer',
        name: 'Filament printer',
        printType: 'filament',
        widthMm: 220,
        depthMm: 220,
        heightMm: 250,
      },
    ])

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
      completedTasks: ['upload', 'inspect'],
      skippedTasks: ['download'],
      celebratedTasks: ['upload'],
    })

    await expect(repository.getUserOnboarding('maker')).resolves.toEqual({
      completedTasks: ['upload', 'inspect'],
      skippedTasks: ['download'],
      celebratedTasks: ['upload'],
    })
  })

  it('isolates workspace onboarding tasks while sharing learning progress', async () => {
    const firstWorkspace = (await repository.listWorkspacesForUser('maker'))[0]
    const secondWorkspace = await repository.createWorkspace({ id: 'maker' }, 'Second workspace')
    await repository.saveUserOnboarding(
      'maker',
      { completedTasks: ['upload', 'printers'], skippedTasks: ['stock'], celebratedTasks: ['upload', 'printers'] },
      firstWorkspace.id,
    )

    await expect(repository.getUserOnboarding('maker', firstWorkspace.id)).resolves.toEqual({
      completedTasks: ['upload', 'printers'],
      skippedTasks: ['stock'],
      celebratedTasks: ['upload', 'printers'],
    })
    await expect(repository.getUserOnboarding('maker', secondWorkspace.id)).resolves.toEqual({
      completedTasks: ['upload'],
      skippedTasks: [],
      celebratedTasks: ['upload'],
    })
  })

  it('isolates notification preferences per workspace membership', async () => {
    const first = await repository.scoped((await repository.listWorkspacesForUser('maker'))[0].id)
    const second = await repository.scoped((await repository.createWorkspace({ id: 'maker' }, 'Second workspace')).id)
    await first.setNotificationPreference('maker', 'print-ready', false)

    expect([await first.notificationPreferences('maker'), await second.notificationPreferences('maker')]).toEqual([
      { 'print-ready': false },
      { 'print-ready': true },
    ])
  })

  it('has no notification preferences for non-members', async () => {
    const workspace = await repository.createWorkspace({ id: 'maker' }, 'Second workspace')
    await expect((await repository.scoped(workspace.id)).notificationPreferences('owner')).resolves.toBeUndefined()
  })

  it('updates and deletes settings in one transaction', async () => {
    await repository.setSetting('old-setting', { enabled: true })

    await repository.setSettings({ 'new-setting': { enabled: false } }, ['old-setting'])

    expect(await Promise.all([repository.getSetting('old-setting'), repository.getSetting('new-setting')])).toEqual([
      undefined,
      { enabled: false },
    ])
  })

  const ipa: Consumable = { id: 'ipa', kind: 'supply', name: 'IPA', unit: 'ml', price: 8 }

  function usageEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
    return {
      id: crypto.randomUUID(),
      transactionId: 'transaction',
      stage: 'stock',
      kind: 'restock',
      consumableId: 'ipa',
      amount: 1_000,
      unit: 'ml',
      createdAt: 1_000,
      ...overrides,
    }
  }

  it('lists usage newest first with only the requested filters', async () => {
    await stock(repository, 'consumables', [ipa])
    await repository.appendUsageEvents([
      usageEvent({ id: 'old', requestId: 'print', createdAt: 1_000 }),
      usageEvent({ id: 'new', requestId: 'print', createdAt: 2_000 }),
      usageEvent({ id: 'other', requestId: 'other-print', createdAt: 3_000 }),
    ])

    expect((await repository.listUsage({ requestId: 'print' })).map((event) => event.id)).toEqual(['new', 'old'])
  })

  it('lists usage within a time range', async () => {
    await stock(repository, 'consumables', [ipa])
    await repository.appendUsageEvents([
      usageEvent({ id: 'before', createdAt: 999 }),
      usageEvent({ id: 'inside', createdAt: 1_000 }),
      usageEvent({ id: 'after', createdAt: 2_000 }),
    ])

    expect((await repository.listUsage({ from: 1_000, to: 2_000 })).map((event) => event.id)).toEqual(['inside'])
  })

  describe('deleting an inventory item', () => {
    const saturn: PrinterProfile = { id: 'saturn', name: 'Saturn', printType: 'resin', archived: true }
    const wash: EquipmentItem = {
      id: 'wash',
      name: 'Wash',
      kind: 'wash',
      stage: 'finishing',
      powerWatts: 50,
      minutesPerUse: 10,
      supplies: [{ consumableId: ipa.id, amountPerUse: 100 }],
    }
    const accept = () => undefined

    async function assignedPrint() {
      return await repository.createRequest({
        name: 'Assigned',
        fileName: 'assigned.stl',
        filePath: 'todo/assigned.stl',
        quantity: 1,
        ownerUserId: 'maker',
        printerId: saturn.id,
      })
    }

    beforeEach(async () => {
      await stock(repository, 'printers', [saturn])
      await stock(repository, 'consumables', [ipa])
      await stock(repository, 'equipment', [wash])
    })

    it('counts what names a printer', async () => {
      const requestId = await assignedPrint()
      await repository.createPlate({
        id: 'plate',
        printerId: saturn.id,
        otherStuff: false,
        items: [{ requestId, copies: 1 }],
        createdAt: 1,
      })
      await repository.appendUsageEvents([
        usageEvent({ stage: 'printing', kind: 'use', printerId: saturn.id, consumableId: undefined, unit: 'minute' }),
        usageEvent({ kind: 'replace', printerId: saturn.id }),
      ])

      expect(await repository.inventoryReferences('printers', saturn.id)).toEqual({
        requests: 1,
        plates: 1,
        usage: 1,
        stock: 1,
        supplies: 0,
        parts: 0,
        bought: 0,
      })
    })

    it('unlinks a deleted printer from its prints and plates', async () => {
      const requestId = await assignedPrint()
      await repository.createPlate({
        id: 'plate',
        printerId: saturn.id,
        otherStuff: false,
        items: [{ requestId, copies: 1 }],
        createdAt: 1,
      })

      await repository.deleteInventoryItem('printers', saturn.id, accept)

      expect({
        request: await repository.getRequest(requestId),
        plate: (await repository.listPlates())[0]?.printerId,
        printers: await repository.listInventory('printers'),
      }).toMatchObject({ request: { printerId: undefined, requestedPrintType: 'resin' }, plate: undefined, printers: [] })
    })

    it('keeps the name of a deleted item on what it was used for', async () => {
      await repository.appendUsageEvents([
        usageEvent({ id: 'restock' }),
        usageEvent({ id: 'wash-run', stage: 'finishing', kind: 'use', equipmentId: wash.id, consumableId: undefined, unit: 'minute' }),
        usageEvent({ id: 'wash-ipa', stage: 'finishing', kind: 'use', equipmentId: wash.id }),
      ])

      await repository.deleteInventoryItem('consumables', ipa.id, accept)
      await repository.deleteInventoryItem('equipment', wash.id, accept)

      expect(
        (await repository.listUsage({}))
          .map(({ id, consumableId, equipmentId, deletedItemName, deletedItemKind }) => ({
            id,
            consumableId,
            equipmentId,
            deletedItemName,
            deletedItemKind,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      ).toEqual([
        { id: 'restock', consumableId: undefined, equipmentId: undefined, deletedItemName: 'IPA', deletedItemKind: 'supply' },
        { id: 'wash-ipa', consumableId: undefined, equipmentId: undefined, deletedItemName: 'IPA', deletedItemKind: 'supply' },
        { id: 'wash-run', consumableId: undefined, equipmentId: undefined, deletedItemName: 'Wash', deletedItemKind: 'equipment' },
      ])
    })

    it('stops equipment using a deleted consumable', async () => {
      await repository.deleteInventoryItem('consumables', ipa.id, accept)

      expect((await repository.listInventory('equipment'))[0].supplies).toEqual([])
    })

    it('changes nothing when the check refuses', async () => {
      await repository.appendUsageEvents([usageEvent({ id: 'restock' })])

      await repository
        .deleteInventoryItem('consumables', ipa.id, () => {
          throw new Response('no', { status: 409 })
        })
        .catch(() => undefined)

      expect({
        library: (await repository.listInventory('consumables')).map(({ id }) => id),
        usage: (await repository.listUsage({})).map(({ consumableId }) => consumableId),
      }).toEqual({ library: [ipa.id], usage: [ipa.id] })
    })

    it('leaves another workspace’s item of the same ID alone', async () => {
      const other = await repository.scoped((await repository.createWorkspace({ id: 'maker' }, 'Second farm')).id)
      await stock(other, 'consumables', [ipa])
      await other.appendUsageEvents([usageEvent({ id: 'theirs' })])

      await repository.deleteInventoryItem('consumables', ipa.id, accept)

      expect({
        library: (await other.listInventory('consumables')).map(({ id }) => id),
        usage: (await other.listUsage({})).map(({ consumableId }) => consumableId),
      }).toEqual({ library: [ipa.id], usage: [ipa.id] })
    })
  })

  it('sums live stock per consumable, kind, and unit', async () => {
    await stock(repository, 'consumables', [ipa])
    await repository.appendUsageEvents([
      usageEvent({ id: 'first', transactionId: 'first' }),
      usageEvent({ id: 'second', transactionId: 'second', amount: 500 }),
      usageEvent({ id: 'used', transactionId: 'used', kind: 'use', amount: 40 }),
    ])
    await repository.undoUsageTransaction('second', 2_000)

    expect(await repository.stockTotals()).toEqual(
      expect.arrayContaining([
        { consumableId: 'ipa', kind: 'restock', unit: 'ml', amount: 1_000 },
        { consumableId: 'ipa', kind: 'use', unit: 'ml', amount: 40 },
      ]),
    )
  })

  describe('maintenance totals', () => {
    const tank: Consumable = {
      id: 'tank',
      kind: 'part',
      name: 'Tank',
      printType: 'resin',
      price: 119,
      lifespan: 190,
      lifespanUnit: 'plates',
    }

    function run(overrides: Partial<UsageEvent> = {}) {
      return usageEvent({
        stage: 'printing',
        kind: 'use',
        consumableId: undefined,
        printerId: 'form-4',
        amount: 120,
        unit: 'minute',
        copies: 2,
        ...overrides,
      })
    }

    function replacement(createdAt: number, overrides: Partial<UsageEvent> = {}) {
      return usageEvent({
        transactionId: `replace-${createdAt}`,
        kind: 'replace',
        consumableId: 'tank',
        printerId: 'form-4',
        amount: 1,
        unit: 'item',
        createdAt,
        ...overrides,
      })
    }

    beforeEach(async () => {
      await stock(repository, 'printers', [{ id: 'form-4', name: 'Form 4', printType: 'resin' }])
      await stock(repository, 'consumables', [ipa, tank])
    })

    it('totals every printing run of a printer, estimates of past prints included', async () => {
      await repository.appendUsageEvents([run(), run({ estimated: true, amount: 60, copies: 1 })])

      expect((await repository.maintenanceTotals()).printers).toEqual([
        { printerId: 'form-4', all: { minutes: 180, plates: 3 }, recorded: { minutes: 120, plates: 2 } },
      ])
    })

    it('leaves undone runs out of a printer’s totals', async () => {
      await repository.appendUsageEvents([run(), run({ transactionId: 'undone' })])
      await repository.undoUsageTransaction('undone', 5_000)

      expect((await repository.maintenanceTotals()).printers[0].all.minutes).toBe(120)
    })

    it('leaves the material and part wear a print recorded out of its runs', async () => {
      await repository.appendUsageEvents([
        run(),
        run({ consumableId: 'tank', unit: 'plate', amount: 2 }),
        run({ consumableId: 'ipa', unit: 'ml', amount: 40 }),
      ])

      expect((await repository.maintenanceTotals()).printers[0].all.minutes).toBe(120)
    })

    it('leaves the wear of a deleted part, which lost its ID, out of the printer’s runs', async () => {
      await repository.appendUsageEvents([run(), run({ deletedItemKind: 'part', deletedItemName: 'Screen' })])

      expect((await repository.maintenanceTotals()).printers[0].all.minutes).toBe(120)
    })

    it('counts a run without copies as one plate', async () => {
      await repository.appendUsageEvents([run({ copies: undefined })])

      expect((await repository.maintenanceTotals()).printers[0].all.plates).toBe(1)
    })

    it('totals the recorded runs since a part’s last replacement on the printer', async () => {
      await repository.appendUsageEvents([
        run({ createdAt: 1_000 }),
        replacement(2_000),
        run({ createdAt: 3_000 }),
        replacement(4_000),
        run({ createdAt: 5_000, copies: 3 }),
        run({ createdAt: 6_000, estimated: true }),
      ])

      expect((await repository.maintenanceTotals()).replacements).toEqual([
        { printerId: 'form-4', consumableId: 'tank', replacedAt: 4_000, since: { minutes: 120, plates: 3 } },
      ])
    })

    it('counts nothing since a replacement no run followed', async () => {
      await repository.appendUsageEvents([run({ createdAt: 1_000 }), replacement(2_000)])

      expect((await repository.maintenanceTotals()).replacements[0].since).toEqual({ minutes: 0, plates: 0 })
    })

    it('leaves an undone replacement out', async () => {
      await repository.appendUsageEvents([replacement(2_000)])
      await repository.undoUsageTransaction('replace-2000', 3_000)

      expect((await repository.maintenanceTotals()).replacements).toEqual([])
    })

    it('keeps maintenance totals within their workspace', async () => {
      await repository.appendUsageEvents([run(), replacement(2_000)])
      const secondary = await repository.scoped((await repository.createWorkspace({ id: 'owner' }, 'Second farm')).id)

      expect(await secondary.maintenanceTotals()).toEqual({ printers: [], replacements: [] })
    })
  })
  it('sums what was used lately per consumable, from when its stock was first logged', async () => {
    await stock(repository, 'consumables', [ipa])
    await repository.appendUsageEvents([
      usageEvent({ id: 'stocked', transactionId: 'stocked', createdAt: 1_000 }),
      usageEvent({ id: 'old-use', transactionId: 'old-use', kind: 'use', amount: 30, createdAt: 2_000 }),
      usageEvent({ id: 'use', transactionId: 'use', kind: 'use', amount: 40, createdAt: 5_000 }),
      usageEvent({ id: 'waste', transactionId: 'waste', kind: 'waste', amount: 10, createdAt: 6_000 }),
      usageEvent({ id: 'estimate', transactionId: 'estimate', kind: 'use', amount: 99, createdAt: 500, estimated: true }),
    ])

    expect(await repository.recentStockUse(4_000)).toEqual([{ consumableId: 'ipa', unit: 'ml', used: 50, firstAt: 1_000 }])
  })

  it('undoes every live event of a transaction once', async () => {
    await stock(repository, 'consumables', [ipa])
    await repository.appendUsageEvents([usageEvent({ id: 'printer' }), usageEvent({ id: 'material' })])

    expect([
      await repository.undoUsageTransaction('transaction', 2_000),
      await repository.undoUsageTransaction('transaction', 3_000),
    ]).toEqual([2, 0])
  })

  it('keeps usage within its workspace', async () => {
    await stock(repository, 'consumables', [ipa])
    const secondary = await repository.scoped((await repository.createWorkspace({ id: 'owner' }, 'Second farm')).id)
    await repository.appendUsageEvents([usageEvent()])

    expect([
      await secondary.listUsage({}),
      await secondary.stockTotals(),
      await secondary.recentStockUse(0),
      await secondary.undoUsageTransaction('transaction', 2_000),
    ]).toEqual([[], [], [], 0])
  })

  describe('charged prints', () => {
    const october = new Date(2026, 9, 20).getTime()
    const november = new Date(2026, 10, 12).getTime()

    async function chargedPrint(target = repository) {
      const id = await target.createRequest({
        name: 'Model',
        fileName: 'model.stl',
        filePath: 'todo/model.stl',
        quantity: 1,
        ownerUserId: 'owner',
      })
      await target.setRequestCharge(id, { amount: 20, currency: 'EUR' })
      return id
    }

    function printing(requestId: string, overrides: Partial<UsageEvent> = {}) {
      return usageEvent({ requestId, stage: 'printing', kind: 'use', amount: 100, unitPrice: 0.04, currency: 'EUR', ...overrides })
    }

    it('totals what a charged print used across every period', async () => {
      await stock(repository, 'consumables', [ipa])
      const id = await chargedPrint()
      await repository.appendUsageEvents([printing(id, { createdAt: october }), printing(id, { createdAt: november })])

      expect((await repository.chargedPrints('EUR'))[0].cost).toBeCloseTo(8)
    })

    it('says what a charged print was charged', async () => {
      const id = await chargedPrint()

      expect((await repository.chargedPrints('EUR'))[0]).toMatchObject({ requestId: id, charged: { amount: 20, currency: 'EUR' } })
    })

    it('dates a charged print by its latest usage', async () => {
      await stock(repository, 'consumables', [ipa])
      const id = await chargedPrint()
      await repository.appendUsageEvents([printing(id, { createdAt: october }), printing(id, { createdAt: november })])

      expect((await repository.chargedPrints('EUR'))[0].finishedAt).toBe(november)
    })

    it('leaves undone usage out of when a charged print finished', async () => {
      await stock(repository, 'consumables', [ipa])
      const id = await chargedPrint()
      await repository.appendUsageEvents([
        printing(id, { createdAt: october }),
        printing(id, { transactionId: 'later', createdAt: november }),
      ])
      await repository.undoUsageTransaction('later', november + 1)

      expect((await repository.chargedPrints('EUR'))[0].finishedAt).toBe(october)
    })

    it('leaves superseded usage out of when a charged print finished', async () => {
      await stock(repository, 'consumables', [ipa])
      const id = await chargedPrint()
      await repository.appendUsageEvents([
        printing(id, { createdAt: october }),
        printing(id, { transactionId: 'replaced', createdAt: november, undoneAt: november, supersededBy: 'plate' }),
      ])

      expect((await repository.chargedPrints('EUR'))[0].finishedAt).toBe(october)
    })

    it('leaves undone usage out of what a charged print used', async () => {
      await stock(repository, 'consumables', [ipa])
      const id = await chargedPrint()
      await repository.appendUsageEvents([
        printing(id, { createdAt: october }),
        printing(id, { transactionId: 'later', createdAt: november }),
      ])
      await repository.undoUsageTransaction('later', november + 1)

      expect((await repository.chargedPrints('EUR'))[0].cost).toBeCloseTo(4)
    })

    it('leaves usage in another currency out of what a charged print used', async () => {
      await stock(repository, 'consumables', [ipa])
      const id = await chargedPrint()
      await repository.appendUsageEvents([printing(id, { createdAt: october }), printing(id, { createdAt: november, currency: 'GBP' })])

      expect((await repository.chargedPrints('EUR'))[0].cost).toBeCloseTo(4)
    })

    it('leaves usage in another currency out of when a charged print finished', async () => {
      await stock(repository, 'consumables', [ipa])
      const id = await chargedPrint()
      await repository.appendUsageEvents([printing(id, { createdAt: october }), printing(id, { createdAt: november, currency: 'GBP' })])

      expect((await repository.chargedPrints('EUR'))[0].finishedAt).toBe(october)
    })

    it('dates a charged print by unpriced usage too', async () => {
      await stock(repository, 'consumables', [ipa])
      const id = await chargedPrint()
      await repository.appendUsageEvents([
        printing(id, { createdAt: october }),
        printing(id, { createdAt: november, unitPrice: undefined, currency: undefined }),
      ])

      expect((await repository.chargedPrints('EUR'))[0].finishedAt).toBe(november)
    })

    it('gives a charged print with no usage no finished date', async () => {
      await chargedPrint()

      expect((await repository.chargedPrints('EUR'))[0].finishedAt).toBeUndefined()
    })

    it('lists only prints with a charge', async () => {
      await repository.createRequest({ name: 'Free', fileName: 'free.stl', filePath: 'todo/free.stl', quantity: 1, ownerUserId: 'owner' })

      expect(await repository.chargedPrints('EUR')).toEqual([])
    })

    it('keeps charged prints within their workspace', async () => {
      await stock(repository, 'consumables', [ipa])
      const id = await chargedPrint()
      await repository.appendUsageEvents([printing(id, { createdAt: october })])
      const secondary = await repository.scoped((await repository.createWorkspace({ id: 'owner' }, 'Second farm')).id)

      expect(await secondary.chargedPrints('EUR')).toEqual([])
    })

    it('leaves another workspace’s usage of the same print id out of a charged print', async () => {
      await stock(repository, 'consumables', [ipa])
      const id = await chargedPrint()
      const secondary = await repository.scoped((await repository.createWorkspace({ id: 'owner' }, 'Second farm')).id)
      await stock(secondary, 'consumables', [ipa])
      await secondary.appendUsageEvents([printing(id, { createdAt: november })])

      expect(await repository.chargedPrints('EUR')).toEqual([{ requestId: id, charged: { amount: 20, currency: 'EUR' }, cost: 0 }])
    })
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

  it('reports when each member was last active in the workspace', async () => {
    const secondary = await repository.scoped((await repository.createWorkspace({ id: 'owner' }, 'Second farm')).id)
    const at = Date.parse('2026-07-12T12:00:00.000Z')
    await repository.recordMemberActivity('maker', at)
    await secondary.recordMemberActivity('owner', at)

    expect(await repository.listMemberActivity()).toEqual([{ userId: 'maker', lastActiveAt: at }])
  })

  it('throttles member activity writes to one per hour', async () => {
    const at = Date.parse('2026-07-12T12:00:00.000Z')
    await repository.recordMemberActivity('maker', at)
    await repository.recordMemberActivity('maker', at + 59 * 60_000)

    expect(await repository.listMemberActivity()).toEqual([{ userId: 'maker', lastActiveAt: at }])
  })

  it('records member activity again once the stored value is over an hour old', async () => {
    const at = Date.parse('2026-07-12T12:00:00.000Z')
    await repository.recordMemberActivity('maker', at)
    await repository.recordMemberActivity('maker', at + 61 * 60_000)

    expect(await repository.listMemberActivity()).toEqual([{ userId: 'maker', lastActiveAt: at + 61 * 60_000 }])
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
    await stock(workspace, 'printers', [
      { id: 'active', name: 'Active', printType: 'resin' },
      { id: 'archived', name: 'Archived', printType: 'filament', archived: true },
    ])
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
      activeJobCount: 2,
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

    expect((await repository.listAccounts()).find((candidate) => candidate.id === 'owner')).toMatchObject({
      plan: 'supporter',
      managedStorageUsedBytes: 0,
      managedStorageQuotaBytes: 25_000_000_000,
      managedStorageWorkspaceCount: 1,
    })
    expect(await repository.getAdminAccountDetails('owner')).toMatchObject({
      id: 'owner',
      plan: 'supporter',
      managedStorageUsedBytes: 0,
      managedStorageQuotaBytes: 25_000_000_000,
      managedStorageWorkspaceCount: 1,
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
    await stock(primary, 'printers', [{ id: 'primary-printer', name: 'Primary printer', printType: 'resin' }])
    await stock(secondary, 'printers', [{ id: 'secondary-printer', name: 'Secondary printer', printType: 'filament' }])
    await primary.createInvite({ id: 'primary-invite', tokenHash: 'primary-token', role: 'admin', expiresAt: Date.now() + 60_000 })
    await secondary.createInvite({
      id: 'secondary-invite',
      tokenHash: 'secondary-token',
      role: 'requester',
      expiresAt: Date.now() + 60_000,
    })
    await primary.createUploadSession('primary-upload', 'owner', Date.now() + 60_000, 3)
    await secondary.createUploadSession('secondary-upload', 'owner', Date.now() + 60_000, 3)
    await primary.setRequestsArchived([primaryRequest], Date.now())
    await secondary.setRequestsArchived([secondaryRequest], Date.now())

    expect(await primary.getRequest(primaryRequest)).toBeTruthy()
    expect(await primary.getRequest(secondaryRequest)).toBeUndefined()
    expect(await secondary.getRequest(primaryRequest)).toBeUndefined()
    expect(await secondary.getRequest(secondaryRequest)).toBeTruthy()
    expect((await primary.queryRequests()).requests).toEqual([])
    expect((await secondary.queryRequests({ filters: { archived: true } })).requests.map(({ id }) => id)).toEqual([secondaryRequest])
    await primary.setRequestsArchived([secondaryRequest], null)
    expect(await secondary.getRequest(secondaryRequest)).toMatchObject({ archivedAt: expect.any(Number) })
    expect(await primary.getRequest(primaryRequest)).toMatchObject({ archivedAt: expect.any(Number) })
    expect(await primary.getSetting('board')).toEqual({ privateRequests: true })
    expect(await secondary.getSetting('board')).toEqual({ privateRequests: false })
    expect(await primary.listInventory('printers')).toEqual([{ id: 'primary-printer', name: 'Primary printer', printType: 'resin' }])
    expect(await secondary.listInventory('printers')).toEqual([
      { id: 'secondary-printer', name: 'Secondary printer', printType: 'filament' },
    ])
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

  it('rejects tag edits that reference another workspace', async () => {
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
    const primaryTag = await primary.createGroup('Primary tag', 'todo', 'blue', [{ requestId: primaryRequest, count: 1 }])
    const secondaryTag = await secondary.createGroup('Secondary tag', 'todo', 'blue', [])

    await expect(
      secondary.updateCopyTags({
        addTagIds: [],
        removeTagIds: [primaryTag],
        items: [{ requestId: secondaryRequest, status: 'todo', count: 1 }],
      }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      secondary.updateCopyTags({
        addTagIds: [secondaryTag],
        removeTagIds: [],
        items: [{ requestId: primaryRequest, status: 'todo', count: 1 }],
      }),
    ).rejects.toMatchObject({ status: 409 })
    expect([(await primary.getGroup(primaryTag))?.items.length, (await secondary.getGroup(secondaryTag))?.items]).toEqual([1, []])
  })

  it('adds and removes tags by the selected copy count', async () => {
    const id = await repository.createRequest({
      name: 'Stacked model',
      fileName: 'stacked.stl',
      filePath: 'todo/stacked.stl',
      quantity: 3,
      ownerUserId: 'maker',
    })
    const kept = await repository.createGroup('Kept', 'todo', 'blue', [{ requestId: id, count: 2 }])
    const removed = await repository.createGroup('Removed', 'todo', 'green', [{ requestId: id, count: 3 }])
    const cleared = await repository.createGroup('Cleared', 'todo', 'amber', [{ requestId: id, count: 1 }])

    await repository.updateCopyTags({
      addTagIds: [kept],
      removeTagIds: [removed, cleared],
      items: [{ requestId: id, status: 'todo', count: 2 }],
    })

    const counts = await Promise.all([kept, removed, cleared].map(async (tag) => (await repository.getGroup(tag))?.items[0]?.count))
    expect(counts).toEqual([3, 1, undefined])
  })

  it('deletes untagged copies without removing tags from tagged copies in the stage', async () => {
    const id = await repository.createRequest({
      name: 'Partly tagged model',
      fileName: 'partly-tagged.stl',
      filePath: 'todo/partly-tagged.stl',
      quantity: 3,
      ownerUserId: 'maker',
    })
    const tag = await repository.createGroup('Tagged', 'todo', 'blue', [{ requestId: id, count: 2 }])

    await repository.deleteCopiesBatch([{ id, status: 'todo', count: 1, deleteRequest: false }])

    expect([(await repository.getRequest(id))?.counts.todo, (await repository.getGroup(tag))?.items[0]?.count]).toEqual([2, 2])
  })

  it('rejects deleting more untagged copies than the stage holds and keeps every copy', async () => {
    const id = await repository.createRequest({
      name: 'Mostly tagged model',
      fileName: 'mostly-tagged.stl',
      filePath: 'todo/mostly-tagged.stl',
      quantity: 3,
      ownerUserId: 'maker',
    })
    const tag = await repository.createGroup('Tagged', 'todo', 'blue', [{ requestId: id, count: 2 }])

    await expect(repository.deleteCopiesBatch([{ id, status: 'todo', count: 2, deleteRequest: false }])).rejects.toMatchObject({
      status: 409,
    })
    expect([(await repository.getRequest(id))?.counts.todo, (await repository.getGroup(tag))?.items[0]?.count]).toEqual([3, 2])
  })

  it('rejects deleting a whole request as untagged copies while some carry tags', async () => {
    const id = await repository.createRequest({
      name: 'Tagged model',
      fileName: 'tagged.stl',
      filePath: 'todo/tagged.stl',
      quantity: 2,
      ownerUserId: 'maker',
    })
    await repository.createGroup('Tagged', 'todo', 'blue', [{ requestId: id, count: 1 }])

    await expect(repository.deleteCopiesBatch([{ id, status: 'todo', count: 2, deleteRequest: true }])).rejects.toMatchObject({
      status: 409,
    })
    expect((await repository.getRequest(id))?.counts.todo).toBe(2)
  })

  it('deletes tagged copies from only the stage of the deleted card', async () => {
    const id = await repository.createRequest({
      name: 'Spread model',
      fileName: 'spread.stl',
      filePath: 'todo/spread.stl',
      quantity: 3,
      ownerUserId: 'maker',
    })
    const tag = await repository.createGroup('Spread', 'todo', 'blue', [{ requestId: id, count: 3 }])
    await repository.moveCopies({ id, from: 'todo', to: 'in_progress', count: 2, tagIds: [tag], filePath: 'todo/spread.stl' })

    await repository.deleteCopiesBatch([{ id, status: 'in_progress', count: 2, tagIds: [tag], deleteRequest: false }])

    expect((await repository.getGroup(tag))?.items).toMatchObject([{ status: 'todo', count: 1 }])
  })

  /** Two To do copies tagged A, one also tagged B and the other also C, so the board draws the cards {A, B} and {A, C}. */
  async function twoMultiTagCards() {
    const id = await repository.createRequest({
      name: 'Multi-tag model',
      fileName: 'multi-tag.stl',
      filePath: 'todo/multi-tag.stl',
      quantity: 3,
      ownerUserId: 'maker',
    })
    await repository.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1, filePath: 'todo/multi-tag.stl' })
    const a = await repository.createGroup('A', 'todo', 'blue', [{ requestId: id, count: 2 }])
    const b = await repository.createGroup('B', 'todo', 'green', [{ requestId: id, count: 1 }])
    const c = await repository.createGroup('C', 'todo', 'amber', [{ requestId: id, count: 1 }])
    const state = async () => [
      (await repository.getRequest(id))?.counts.todo,
      ...(await Promise.all([a, b, c].map(async (tagId) => (await repository.getGroup(tagId))?.items[0]?.count ?? 0))),
    ]
    /** Each stage's copy count and, by tag name, how many of its copies carry each tag. */
    const placement = async () => {
      const request = await repository.getRequest(id)
      const names = new Map<string, string>([
        [a, 'A'],
        [b, 'B'],
        [c, 'C'],
      ])
      const stages: Record<string, Record<string, number>> = {}
      for (const status of ['todo', 'in_progress', 'done']) stages[status] = { copies: request?.counts[status] ?? 0 }
      for (const tag of await repository.listGroups()) {
        for (const item of tag.items) stages[item.status][names.get(tag.id)!] = item.count
      }
      return stages
    }
    return { id, a, b, c, state, placement }
  }

  it('moves a multi-tag card with only the tags its copies carry', async () => {
    const { id, a, b, placement } = await twoMultiTagCards()

    await repository.moveCopies({ id, from: 'todo', to: 'done', count: 1, tagIds: [b, a], filePath: 'todo/multi-tag.stl' })

    expect(await placement()).toEqual({ todo: { copies: 1, A: 1, C: 1 }, in_progress: { copies: 1 }, done: { copies: 1, A: 1, B: 1 } })
  })

  it('moves copies of no named card from the card with the fewest tags first', async () => {
    const id = await repository.createRequest({
      name: 'Two cards',
      fileName: 'two-cards.stl',
      filePath: 'todo/two-cards.stl',
      quantity: 2,
      ownerUserId: 'maker',
    })
    const a = await repository.createGroup('A', 'todo', 'blue', [{ requestId: id, count: 2 }])
    const b = await repository.createGroup('B', 'todo', 'green', [{ requestId: id, count: 1 }])

    await repository.moveCopies({ id, from: 'todo', to: 'done', count: 1, filePath: 'todo/two-cards.stl' })

    expect(
      Object.fromEntries(
        (await repository.listGroups()).map(({ id: tagId, items }) => [
          tagId,
          Object.fromEntries(items.map(({ status, count: copies }) => [status, copies])),
        ]),
      ),
    ).toEqual({ [a]: { todo: 1, done: 1 }, [b]: { todo: 1 } })
  })

  it('moves two cards of the same print in one batch', async () => {
    const { id, a, b, c, placement } = await twoMultiTagCards()

    await repository.moveCopiesBatch([
      { id, from: 'todo', to: 'done', count: 1, tagIds: [a, b], filePath: 'todo/multi-tag.stl' },
      { id, from: 'todo', to: 'in_progress', count: 1, tagIds: [a, c], filePath: 'todo/multi-tag.stl' },
    ])

    expect(await placement()).toEqual({ todo: { copies: 0 }, in_progress: { copies: 2, A: 1, C: 1 }, done: { copies: 1, A: 1, B: 1 } })
  })

  it('rejects moving a card the stage no longer holds and keeps every copy in place', async () => {
    const { id, b, c, state } = await twoMultiTagCards()

    await expect(
      repository.moveCopies({ id, from: 'todo', to: 'done', count: 1, tagIds: [b, c], filePath: 'todo/multi-tag.stl' }),
    ).rejects.toMatchObject({ status: 409 })
    expect(await state()).toEqual([2, 2, 1, 1])
  })

  it('rejects a batch whose cards together outnumber a card and moves nothing', async () => {
    const { id, a, b, state } = await twoMultiTagCards()

    await expect(
      repository.moveCopiesBatch([
        { id, from: 'todo', to: 'done', count: 1, tagIds: [a, b], filePath: 'todo/multi-tag.stl' },
        { id, from: 'todo', to: 'in_progress', count: 1, tagIds: [b, a], filePath: 'todo/multi-tag.stl' },
      ]),
    ).rejects.toMatchObject({ status: 409 })
    expect(await state()).toEqual([2, 2, 1, 1])
  })

  it('moves a whole tag with the other tags its copies carry', async () => {
    const { id, a, placement } = await twoMultiTagCards()

    await repository.moveGroup(a, 'todo', 'done', [{ id, from: 'todo', to: 'done', count: 2, filePath: 'todo/multi-tag.stl' }])

    expect(await placement()).toEqual({ todo: { copies: 0 }, in_progress: { copies: 1 }, done: { copies: 2, A: 2, B: 1, C: 1 } })
  })

  it('moves a whole tag without the copies of other cards that share its other tags', async () => {
    const { id, b, placement } = await twoMultiTagCards()

    await repository.moveGroup(b, 'todo', 'done', [{ id, from: 'todo', to: 'done', count: 1, filePath: 'todo/multi-tag.stl' }])

    expect(await placement()).toEqual({ todo: { copies: 1, A: 1, C: 1 }, in_progress: { copies: 1 }, done: { copies: 1, A: 1, B: 1 } })
  })

  it('deletes a multi-tag card and only the tags its copies carry', async () => {
    const { id, a, b, state } = await twoMultiTagCards()

    await repository.deleteCopiesBatch([{ id, status: 'todo', count: 1, tagIds: [a, b], deleteRequest: false }])

    expect(await state()).toEqual([1, 1, 0, 1])
  })

  it('deletes two cards of the same print in one stage together', async () => {
    const { id, a, b, c, state } = await twoMultiTagCards()

    await repository.deleteCopiesBatch([
      { id, status: 'todo', count: 1, tagIds: [a, b], deleteRequest: false },
      { id, status: 'todo', count: 1, tagIds: [a, c], deleteRequest: false },
    ])

    expect(await state()).toEqual([0, 0, 0, 0])
  })

  it('rejects deleting more copies than a multi-tag card holds and keeps every copy', async () => {
    const { id, a, b, state } = await twoMultiTagCards()

    await expect(
      repository.deleteCopiesBatch([{ id, status: 'todo', count: 2, tagIds: [a, b], deleteRequest: false }]),
    ).rejects.toMatchObject({ status: 409 })
    expect(await state()).toEqual([2, 2, 1, 1])
  })

  it('rejects a batch whose cards together outnumber the copies and keeps every copy', async () => {
    const { id, a, b, state } = await twoMultiTagCards()

    await expect(
      repository.deleteCopiesBatch([
        { id, status: 'todo', count: 1, tagIds: [a, b], deleteRequest: false },
        { id, status: 'todo', count: 1, tagIds: [b, a], deleteRequest: false },
      ]),
    ).rejects.toMatchObject({ status: 409 })
    expect(await state()).toEqual([2, 2, 1, 1])
  })

  it('rejects deleting copies with a set of tags no copy carries', async () => {
    const { id, b, c, state } = await twoMultiTagCards()

    await expect(
      repository.deleteCopiesBatch([{ id, status: 'todo', count: 1, tagIds: [b, c], deleteRequest: false }]),
    ).rejects.toMatchObject({ status: 409 })
    expect(await state()).toEqual([2, 2, 1, 1])
  })

  it('rejects deleting a request whose copies changed since the batch was planned', async () => {
    const { id, a, b, c } = await twoMultiTagCards()

    await expect(
      repository.deleteCopiesBatch([
        { id, status: 'todo', count: 1, tagIds: [a, b], deleteRequest: true },
        { id, status: 'todo', count: 1, tagIds: [a, c], deleteRequest: true },
      ]),
    ).rejects.toMatchObject({ status: 409 })
    expect((await repository.getRequest(id))?.quantity).toBe(3)
  })

  /** Runs `race` on fresh prints from two connections at once, returning each print's outcome and whether each side lost with 409. */
  async function raceTwice(
    setup: (index: number) => Promise<string>,
    race: (connection: DrizzleRepository, id: string) => Promise<unknown>,
    outcome: (id: string) => Promise<unknown>,
  ) {
    const other = await reopenRepository()
    const results = []
    for (let index = 0; index < 10; index++) {
      const id = await setup(index)
      const settled = await Promise.allSettled([race(repository, id), race(other, id)])
      results.push({
        outcome: await outcome(id),
        conflicts: settled.filter((result) => result.status === 'rejected' && result.reason?.status === 409).length,
      })
    }
    await other.close()
    return results
  }

  it('moves the same untagged card once when two moves race', async () => {
    const results = await raceTwice(
      async (index) =>
        await repository.createRequest({
          name: `Race ${index}`,
          fileName: `race-${index}.stl`,
          filePath: `todo/race-${index}.stl`,
          quantity: 1,
          ownerUserId: 'maker',
        }),
      async (connection, id) =>
        await connection.moveCopies({ id, from: 'todo', to: 'done', count: 1, tagIds: [], filePath: 'todo/race.stl' }),
      async (id) => {
        const { counts } = (await repository.getRequest(id))!
        return { todo: counts.todo, done: counts.done }
      },
    )

    expect(results).toEqual(Array.from({ length: 10 }, () => ({ outcome: { todo: 0, done: 1 }, conflicts: 1 })))
  })

  it('deletes the same untagged card once when two deletes race', async () => {
    const tags = new Map<string, string>()
    const results = await raceTwice(
      async (index) => {
        const id = await repository.createRequest({
          name: `Race ${index}`,
          fileName: `race-${index}.stl`,
          filePath: `todo/race-${index}.stl`,
          quantity: 3,
          ownerUserId: 'maker',
        })
        await repository.moveCopies({ id, from: 'todo', to: 'done', count: 1, filePath: `todo/race-${index}.stl` })
        tags.set(id, await repository.createGroup(`Race ${index}`, 'todo', 'blue', [{ requestId: id, count: 1 }]))
        return id
      },
      async (connection, id) => await connection.deleteCopiesBatch([{ id, status: 'todo', count: 1, tagIds: [], deleteRequest: false }]),
      async (id) => ({
        todo: (await repository.getRequest(id))?.counts.todo,
        tagged: (await repository.getGroup(tags.get(id)!))?.items[0]?.count,
      }),
    )

    expect(results).toEqual(Array.from({ length: 10 }, () => ({ outcome: { todo: 1, tagged: 1 }, conflicts: 1 })))
  })

  it('rejects renaming a tag to a name another tag uses', async () => {
    await repository.createGroup('Plate', 'todo', 'blue', [])
    const tag = await repository.createGroup('Batch', 'todo', 'green', [])

    await expect(repository.updateGroup(tag, { name: 'PLATE' })).rejects.toMatchObject({ status: 409 })
  })

  it('scopes tag name clashes to tags with the same parent', async () => {
    const parent = await repository.createGroup('Build plates', 'todo', 'green', [])
    await repository.createGroup('Plate', 'todo', 'blue', [], parent)
    const root = await repository.createGroup('PLATE', 'todo', 'blue', [])

    await expect(repository.updateGroup(root, { parentId: parent })).rejects.toMatchObject({ status: 409 })
  })

  it('creates one tag when concurrent creates use the same name', async () => {
    const others = await Promise.all([1, 2, 3].map(() => reopenRepository()))
    const repositories = [repository, ...others]

    await Promise.allSettled(Array.from({ length: 40 }, (_, index) => repositories[index % 4].createGroup('Race', 'todo', 'blue', [])))
    await Promise.all(others.map((other) => other.close()))

    expect((await repository.listGroups()).filter((group) => group.name === 'Race')).toHaveLength(1)
  })

  it('rejects moving a tag under its own descendant', async () => {
    const root = await repository.createGroup('Root', 'todo', 'blue', [])
    const child = await repository.createGroup('Child', 'todo', 'blue', [], root)

    await expect(repository.updateGroup(root, { parentId: child })).rejects.toMatchObject({ status: 409 })
  })

  it('moves a tag under a branch that already loops', async () => {
    const left = await repository.createGroup('Left', 'todo', 'blue', [])
    const right = await repository.createGroup('Right', 'todo', 'blue', [], left)
    const moved = await repository.createGroup('Moved', 'todo', 'blue', [])
    await repository.database.update(printGroups).set({ parentId: right }).where(eq(printGroups.id, left)).run()

    await repository.updateGroup(moved, { parentId: left })

    expect((await repository.getGroup(moved))?.parentId).toBe(left)
  })

  it('never creates a tag parent loop when concurrent moves cross', async () => {
    const others = await Promise.all([1, 2, 3].map(() => reopenRepository()))
    const pairs = await Promise.all(
      Array.from({ length: 10 }, async (_, index) => [
        await repository.createGroup(`Left ${index}`, 'todo', 'blue', []),
        await repository.createGroup(`Right ${index}`, 'todo', 'blue', []),
      ]),
    )

    await Promise.allSettled(
      pairs.flatMap(([left, right], index) => [
        others[index % 3].updateGroup(left, { parentId: right }),
        [repository, ...others][(index + 1) % 4].updateGroup(right, { parentId: left }),
      ]),
    )
    await Promise.all(others.map((other) => other.close()))

    const parents = new Map((await repository.listGroups()).map((group) => [group.id, group.parentId]))
    expect(pairs.filter(([left, right]) => parents.get(left) === right && parents.get(right) === left)).toEqual([])
  })

  it('keeps tags that already share a name editable', async () => {
    const parent = await repository.createGroup('Build plates', 'todo', 'green', [])
    const now = Date.now()
    await repository.database
      .insert(printGroups)
      .values(
        ['first', 'second'].map((id) => ({
          id,
          workspaceId: 'test-workspace',
          name: 'Plate',
          color: 'blue' as const,
          statusId: 'todo',
          createdAt: now,
          updatedAt: now,
        })),
      )
      .run()

    await repository.updateGroup('second', { name: 'Plate', color: 'violet', parentId: parent })

    expect(await repository.getGroup('second')).toMatchObject({ name: 'Plate', color: 'violet', parentId: parent })
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

    expect(await database.get(drizzleSql`SELECT count(*) count FROM __drizzle_migrations`)).toEqual({ count: 49 })
    await migrated.close()
  })

  it('lists inventory in the order it was added, archived items included', async () => {
    await stock(repository, 'consumables', [
      { id: 'grey', kind: 'resin', name: 'Grey', pricePerLitre: 30, densityGramsPerMl: 1.1 },
      { id: 'black', kind: 'resin', name: 'Black', pricePerLitre: 32, densityGramsPerMl: 1.1, archived: true },
    ])
    await stock(repository, 'consumables', [{ id: 'clear', kind: 'resin', name: 'Clear', pricePerLitre: 35, densityGramsPerMl: 1.1 }])

    expect((await repository.listInventory('consumables')).map(({ id, archived }) => ({ id, archived }))).toEqual([
      { id: 'grey', archived: undefined },
      { id: 'black', archived: true },
      { id: 'clear', archived: undefined },
    ])
  })

  it('keeps a printer’s purchase date', async () => {
    await stock(repository, 'printers', [{ id: 'saturn', name: 'Saturn', printType: 'resin', purchasedOn: '2025-03-14' }])

    expect((await repository.listInventory('printers'))[0].purchasedOn).toBe('2025-03-14')
  })

  it('keeps a piece of equipment’s purchase date', async () => {
    await stock(repository, 'equipment', [
      {
        id: 'wash',
        name: 'Wash',
        kind: 'wash',
        stage: 'finishing',
        powerWatts: 50,
        minutesPerUse: 10,
        supplies: [],
        purchasedOn: '2024-06-01',
      },
    ])

    expect((await repository.listInventory('equipment'))[0].purchasedOn).toBe('2024-06-01')
  })

  it('keeps the catalogue supply a supply was added from', async () => {
    await stock(repository, 'consumables', [{ ...ipa, supplyPresetId: 'supply-isopropyl-alcohol' }])

    expect(await repository.listInventory('consumables')).toEqual([{ ...ipa, supplyPresetId: 'supply-isopropyl-alcohol' }])
  })

  it('keeps edits to different items made at the same time', async () => {
    await stock(repository, 'printers', [
      { id: 'saturn', name: 'Saturn', printType: 'resin' },
      { id: 'mk4', name: 'MK4', printType: 'filament' },
    ])
    const rename = (id: string, name: string) =>
      repository.changeInventory('printers', (items) => items.map((item) => (item.id === id ? { ...item, name } : item)))

    await Promise.all([rename('saturn', 'Saturn bay 1'), rename('mk4', 'MK4 bay 2')])

    expect((await repository.listInventory('printers')).map(({ name }) => name)).toEqual(['Saturn bay 1', 'MK4 bay 2'])
  })

  it('refuses a change that drops an item rather than archiving it', async () => {
    await stock(repository, 'equipment', [
      { id: 'wash', name: 'Wash', kind: 'wash', stage: 'finishing', powerWatts: 50, minutesPerUse: 10, supplies: [] },
    ])

    await expect(repository.changeInventory('equipment', () => [])).rejects.toThrow('archived, never removed')
    expect(await repository.listInventory('equipment')).toHaveLength(1)
  })

  it('archives a printer without changing its request history', async () => {
    const printer: PrinterProfile = { id: 'retired-filament', name: 'Retired filament printer', printType: 'filament' }
    await stock(repository, 'printers', [printer])
    const request = await repository.createRequest({
      name: 'Assigned model',
      fileName: 'assigned.stl',
      filePath: 'todo/assigned.stl',
      quantity: 1,
      ownerUserId: 'maker',
      printerId: printer.id,
    })

    await repository.changeInventory('printers', (items) => items.map((item) => ({ ...item, archived: true })))

    expect(await repository.getRequest(request)).toMatchObject({ printerId: printer.id, requestedPrintType: undefined })
    expect(await repository.listInventory('printers')).toEqual([{ ...printer, archived: true }])
  })

  it('restores an archived printer', async () => {
    const printer: PrinterProfile = { id: 'archived', name: 'Archived', printType: 'resin', archived: true }
    await stock(repository, 'printers', [printer])

    await repository.changeInventory('printers', (items) => items.map((item) => ({ ...item, archived: undefined })))

    expect(await repository.listInventory('printers')).toEqual([{ id: printer.id, name: printer.name, printType: printer.printType }])
  })

  it('rejects a print assigned to a printer the workspace does not have', async () => {
    await expect(
      repository.createRequest({
        name: 'Misassigned model',
        fileName: 'misassigned.stl',
        filePath: 'todo/misassigned.stl',
        quantity: 1,
        ownerUserId: 'maker',
        printerId: 'missing',
      }),
    ).rejects.toThrow()
  })

  it('rejects usage of a consumable the workspace does not have', async () => {
    await expect(
      repository.appendUsageEvents([
        { id: 'use', transactionId: 'use', stage: 'stock', kind: 'restock', consumableId: 'missing', amount: 1, unit: 'ml', createdAt: 0 },
      ]),
    ).rejects.toThrow()
  })

  it('lets two workspaces keep items with the same ID', async () => {
    const second = await repository.scoped((await repository.createWorkspace({ id: 'maker' }, 'Second farm')).id)
    await stock(repository, 'printers', [{ id: 'bay-1', name: 'Saturn', printType: 'resin' }])
    await stock(second, 'printers', [{ id: 'bay-1', name: 'MK4', printType: 'filament' }])

    expect([(await repository.listInventory('printers'))[0].name, (await second.listInventory('printers'))[0].name]).toEqual([
      'Saturn',
      'MK4',
    ])
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

    await stock(repository, 'printers', [{ id: 'small', name: 'Small', printType: 'resin', widthMm: 100, depthMm: 100 }])

    expect(await repository.getRequest(request)).toMatchObject({ printerId: undefined, requestedPrintType: 'resin' })
  })

  it('stores the catalogue model a printer is named after', async () => {
    await stock(repository, 'printers', [{ id: 'mars-2', name: 'Elegoo Mars 2', printType: 'resin', widthMm: 100, depthMm: 100 }])

    expect((await repository.listInventory('printers'))[0]?.presetId).toBe('resin-elegoo-mars-2')
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

    await stock(repository, 'printers', [
      { id: 'small', name: 'Small', printType: 'resin', widthMm: 100, depthMm: 100, heightMm: 100 },
      { id: 'large', name: 'Large', printType: 'resin', widthMm: 200, depthMm: 200, heightMm: 200 },
    ])

    expect(await repository.getRequest(request)).toMatchObject({ printerId: undefined, requestedPrintType: 'resin' })
  })

  it('shortens workspace names longer than the workspace name limit when the repository starts', async () => {
    const workspaceId = 'test-workspace'
    await repository.database
      .update(organization)
      .set({ name: `${'L'.repeat(100)}'s workspace` })
      .where(eq(organization.id, workspaceId))
      .run()

    const reopened = await reopenRepository()

    expect((await repository.workspaceById(workspaceId))?.name).toBe('L'.repeat(MAX_WORKSPACE_NAME_LENGTH))
    await reopened.close()
  })

  it('backfills existing pooled requests when the repository starts', async () => {
    await stock(repository, 'printers', [
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
    await stock(repository, 'printers', [{ id: 'small', name: 'Small', printType: 'resin' }])
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
    await stock(repository, 'printers', [
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

  it('keeps an archived automatic assignment when the repository reopens', async () => {
    await stock(repository, 'printers', [
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
    const archived = await repository.createRequest({
      name: 'Printed last month',
      fileName: 'printed-last-month.stl',
      filePath: 'todo/printed-last-month.stl',
      quantity: 1,
      ownerUserId: 'maker',
      printerId: 'small',
      automaticPrinterAssignment: true,
    })
    await repository.database.update(requests).set({ archivedAt: 123 }).where(eq(requests.id, archived)).run()

    const reopened = await reopenRepository()

    expect(await repository.getRequest(archived)).toMatchObject({ printerId: 'small' })
    await reopened.close()
  })

  it('keeps the automatic assignment of a print whose copies are all ready when the repository reopens', async () => {
    await stock(repository, 'printers', [
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
    const printed = await repository.createRequest({
      name: 'Printed and ready',
      fileName: 'printed-and-ready.stl',
      filePath: 'todo/printed-and-ready.stl',
      quantity: 1,
      ownerUserId: 'maker',
      printerId: 'small',
      automaticPrinterAssignment: true,
    })
    await repository.database
      .update(requestStatuses)
      .set({ quantity: 0 })
      .where(and(eq(requestStatuses.requestId, printed), eq(requestStatuses.statusId, 'todo')))
      .run()
    await repository.database
      .update(requestStatuses)
      .set({ quantity: 1 })
      .where(and(eq(requestStatuses.requestId, printed), eq(requestStatuses.statusId, 'done')))
      .run()

    const reopened = await reopenRepository()

    expect(await repository.getRequest(printed)).toMatchObject({ printerId: 'small' })
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

  it('refuses to convert released bytes after upload expiry', async () => {
    await repository.claimManagedStorage('owner', 3)
    await repository.createUploadSession('expired-upload', 'owner', Date.now() + 60_000, 3)
    await repository.reserveUpload('expired-upload', 'owner', 60, Date.now() - 1, { count: 3, bytes: 100, managedBytes: 100 })
    await expect(repository.beginManagedUploadFinalize('expired-upload')).rejects.toMatchObject({ status: 409 })
  })

  it('keeps an already converted upload reservation through expiry', async () => {
    const expired = Date.now() - 1
    await repository.claimManagedStorage('owner', 3)
    await repository.createUploadSession('finalizing-upload', 'owner', expired, 3)
    await repository.reserveUpload('finalizing-upload', 'owner', 60, Date.now() + 60_000, {
      count: 3,
      bytes: 100,
      managedBytes: 100,
    })
    expect(await repository.beginManagedUploadFinalize('finalizing-upload')).toBe(60)
    await repository.database.update(uploadSessions).set({ expiresAt: expired }).where(eq(uploadSessions.id, 'finalizing-upload')).run()
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

  it("carries a surviving workspace's managed storage usage over to the owner taking its entitlement", async () => {
    await insertUser(repository, { id: 'co-owner', name: 'Co-owner', email: 'co-owner@example.com', workspaceRole: 'owner' })
    await repository.claimManagedStorage('owner', 3)
    await repository.reconcileManagedStorageUsage(40)

    await repository.handOverManagedStorage('owner', [], 3)

    expect(await repository.managedStorageRemaining(100, 'co-owner')).toBe(60)
  })

  // A claim locks its account before counting; the handover has to do the same before choosing a successor.
  it.skipIf(backend === 'sqlite')(
    'keeps the successor within the workspace limit when it claims included storage during a handover',
    async () => {
      await insertUser(repository, { id: 'co-owner', name: 'Co-owner', email: 'co-owner@example.com', workspaceRole: 'owner' })
      await repository.claimManagedStorage('owner', 3)
      for (const name of ['First', 'Second'])
        await (await repository.scoped((await repository.createWorkspace({ id: 'co-owner' }, name)).id)).claimManagedStorage('co-owner', 3)
      const third = await repository.createWorkspace({ id: 'co-owner' }, 'Third')
      let handover: Promise<unknown> | undefined

      await repository.database.transaction(async (tx) => {
        await tx.run(drizzleSql`UPDATE managed_storage_accounts SET persisted_bytes = persisted_bytes WHERE owner_id = 'co-owner'`)
        await tx.run(drizzleSql`INSERT INTO managed_storage_entitlements (workspace_id, owner_id) VALUES (${third.id}, 'co-owner')`)
        handover = repository.handOverManagedStorage('owner', [], 3).catch(() => undefined)
        await vi.waitFor(async () =>
          expect(
            (
              await repository.database.get<{ waiting: number }>(
                drizzleSql`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock'`,
              )
            )?.waiting,
          ).toBe(1),
        )
      })
      await handover

      expect(await repository.managedStorageEntitlementCount('co-owner')).toBe(3)
    },
  )

  async function waitForLockWaiters(expected: number, settled: () => boolean = () => false) {
    await vi.waitFor(async () => {
      const waiting = (
        await repository.database.get<{ waiting: number }>(
          drizzleSql`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock'`,
        )
      )?.waiting
      expect(settled() || waiting === expected).toBe(true)
    })
  }

  async function managedStorageRemainders() {
    return {
      successor: await repository.managedStorageRemaining(100, 'co-owner'),
      previous: await repository.managedStorageRemaining(100, 'owner'),
    }
  }

  async function reserveUploadBytes(bytes: number) {
    await repository.createUploadSession('moving-upload', 'owner', Date.now() + 60_000, 1)
    await repository.reserveUpload('moving-upload', 'owner', bytes, Date.now() + 60_000, { count: 1, bytes: 100, managedBytes: 100 })
  }

  // The handover is held after locking both accounts, so each operation reads the old holder and then waits for its lock.
  it.skipIf(backend === 'sqlite').each([
    { operation: 'an asset removal', setup: async () => {}, run: () => repository.finishManagedAssetReservation(0, -40), successor: 100 },
    { operation: 'an asset reservation', setup: async () => {}, run: () => repository.reserveManagedAssetBytes(10, 100), successor: 50 },
    { operation: 'a usage reconciliation', setup: async () => {}, run: () => repository.reconcileManagedStorageUsage(25), successor: 75 },
    {
      operation: 'an upload finalization start',
      setup: () => reserveUploadBytes(30),
      run: () => repository.beginManagedUploadFinalize('moving-upload'),
      successor: 30,
    },
    {
      operation: 'an upload finalization finish',
      setup: async () => {
        await reserveUploadBytes(30)
        await repository.beginManagedUploadFinalize('moving-upload')
      },
      run: () => repository.finishManagedUploadFinalize('moving-upload', 30),
      successor: 30,
    },
  ])('settles $operation against the account that takes the entitlement mid-flight', async ({ setup, run, successor }) => {
    await insertUser(repository, { id: 'co-owner', name: 'Co-owner', email: 'co-owner@example.com', workspaceRole: 'owner' })
    await repository.claimManagedStorage('owner', 3)
    await repository.reconcileManagedStorageUsage(40)
    await setup()
    let handover: Promise<unknown> | undefined
    let operation: Promise<unknown> | undefined

    await repository.database.transaction(async (tx) => {
      await tx.run(drizzleSql`SELECT owner_id FROM managed_storage_entitlements WHERE workspace_id = 'test-workspace' FOR UPDATE`)
      handover = repository.handOverManagedStorage('owner', [], 3)
      await waitForLockWaiters(1)
      operation = run()
      await waitForLockWaiters(2)
    })
    await Promise.all([handover, operation])

    expect(await managedStorageRemainders()).toEqual({ successor, previous: 100 })
  })

  // The old holder's account is held, so the operation reads it as holder and then waits while the entitlement is released and
  // reclaimed. The release needs that lock too, so either the operation settles first or it finds no entitlement and is refused.
  it.skipIf(backend === 'sqlite')('keeps account usage exact when an operation overlaps a release and reclaim', async () => {
    await insertUser(repository, { id: 'co-owner', name: 'Co-owner', email: 'co-owner@example.com', workspaceRole: 'owner' })
    await repository.claimManagedStorage('owner', 3)
    await repository.reconcileManagedStorageUsage(40)
    let operation: Promise<unknown> | undefined
    let moved: Promise<unknown> | undefined
    let movedSettled = false

    await repository.database.transaction(async (tx) => {
      await tx.run(drizzleSql`UPDATE managed_storage_accounts SET persisted_bytes = persisted_bytes WHERE owner_id = 'owner'`)
      operation = repository.finishManagedAssetReservation(0, 10).catch((error: Error) => {
        if (error.message !== 'managed storage entitlement is missing') throw error
      })
      await waitForLockWaiters(1)
      moved = repository
        .releaseManagedStorage()
        .then(() => repository.claimManagedStorage('co-owner', 3))
        .finally(() => (movedSettled = true))
      await waitForLockWaiters(2, () => movedSettled)
    })
    await Promise.all([operation, moved])
    const [{ usedBytes }] = await repository.managedStorageWorkspaceUsage('co-owner')

    expect(await managedStorageRemainders()).toEqual({ successor: 100 - usedBytes, previous: 100 })
  })

  it("carries a workspace's managed storage usage across a release and reclaim", async () => {
    await insertUser(repository, { id: 'co-owner', name: 'Co-owner', email: 'co-owner@example.com', workspaceRole: 'owner' })
    await repository.claimManagedStorage('owner', 3)
    await repository.reconcileManagedStorageUsage(40)

    await repository.releaseManagedStorage()
    await repository.claimManagedStorage('co-owner', 3)

    expect(await managedStorageRemainders()).toEqual({ successor: 60, previous: 100 })
  })

  it('leaves the entitlement of a workspace deleted with the account out of the handover', async () => {
    await repository.claimManagedStorage('owner', 3)

    expect(await repository.managedStorageHandoverBlockers('owner', ['test-workspace'], 3)).toEqual([])
  })

  it('reports a surviving workspace with no other owner to take its entitlement', async () => {
    await repository.claimManagedStorage('owner', 3)

    expect(await repository.managedStorageHandoverBlockers('owner', [], 3)).toEqual(['Test workspace'])
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

  it('explains why a new upload session was rejected', async () => {
    const expires = Date.now() + 60_000
    await repository.createUploadSession('only-upload', 'owner', expires, 1)
    await repository.reserveUpload('only-upload', 'owner', 1, expires, { count: 1, bytes: 100 })
    await expect(repository.createUploadSession('rejected-upload', 'owner', expires, 1)).rejects.toThrow(
      expect.objectContaining({ statusText: 'too many incomplete uploads' }),
    )
  })

  it('releases the oldest idle upload when the limit is reached', async () => {
    const idleBefore = Date.now() + 60_000
    for (const [id, offset] of [
      ['idle-upload-old', -2],
      ['idle-upload-newer', -1],
      ['active-upload', 1],
    ] as const) {
      await repository.createUploadSession(id, 'owner', idleBefore + offset, 3)
      await repository.reserveUpload(id, 'owner', 1, idleBefore + offset, { count: 3, bytes: 100 })
    }
    expect(await repository.createUploadSession('next-upload', 'owner', idleBefore + 60_000, 3, idleBefore)).toEqual({ fresh: true })
    expect(
      (await repository.database.select({ id: uploadSessions.id }).from(uploadSessions).where(eq(uploadSessions.ownerId, 'owner')).all())
        .map(({ id }) => id)
        .sort(),
    ).toEqual(['active-upload', 'idle-upload-newer', 'idle-upload-old', 'next-upload'])
    expect(await repository.refreshUploadSession('idle-upload-old', 'owner', idleBefore, 1)).toBe(false)
    expect(await repository.expireUploads(Date.now())).toEqual(['idle-upload-old'])
  })

  it('keeps rejecting new uploads while every unfinished upload is active', async () => {
    const idleBefore = Date.now() + 60_000
    for (const id of ['active-upload-one', 'active-upload-two', 'active-upload-three']) {
      await repository.createUploadSession(id, 'owner', idleBefore, 3)
      await repository.reserveUpload(id, 'owner', 1, idleBefore, { count: 3, bytes: 100 })
    }
    await expect(repository.createUploadSession('next-upload', 'owner', idleBefore + 60_000, 3, idleBefore)).rejects.toThrow(
      expect.objectContaining({ status: 429 }),
    )
  })

  it('releases a cancelled upload session', async () => {
    const expires = Date.now() + 60_000
    await repository.createUploadSession('cancelled-upload', 'owner', expires, 1)
    await repository.reserveUpload('cancelled-upload', 'owner', 1, expires, { count: 1, bytes: 100 })
    expect(await repository.refreshUploadSession('cancelled-upload', 'owner', expires, 2)).toBe(false)
    expect(await repository.canCancelUpload('cancelled-upload', 'other')).toBe(false)
    await repository.releaseUploadSession('cancelled-upload', 'owner')
    expect(await repository.createUploadSession('next-upload', 'owner', expires, 1)).toEqual({ fresh: true })
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
