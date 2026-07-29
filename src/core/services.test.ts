import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { LocalAssetStore } from '../adapters/filesystem'
import { UploadStaging } from '../adapters/staging'
import { LocalEventBus } from '../adapters/events'
import { createDatabase } from '../db'
import { DrizzleRepository } from '../db/repository'
import { organization, requests, requestStatuses, user } from '../db/schema'
import type { Identity, PrinterProfile, Telemetry } from './types'
import { STLQuestService } from './services'

const capture = vi.fn(async () => undefined)
const telemetry: Telemetry = { capture, exception: async () => undefined }
const admin: Identity = { id: 'admin', email: 'op@example.com', name: 'Admin', role: 'admin' }
const requester: Identity = { id: 'requester', email: 'owner@example.com', name: 'Owner', role: 'requester' }
const otherRequester: Identity = { id: 'other-requester', email: 'someone-else@example.com', name: 'Someone Else', role: 'requester' }
const slaPrinter: PrinterProfile = {
  id: 'sla-printer',
  name: 'Elegoo Saturn',
  printType: 'resin',
  widthMm: 100,
  depthMm: 100,
}
const largeResinPrinter = { ...slaPrinter, id: 'large-resin-printer', name: 'Large resin printer', widthMm: 200, depthMm: 200 }
const filamentPrinter = {
  id: 'filament-printer',
  name: 'Prusa MK4',
  printType: 'filament',
} satisfies PrinterProfile

describe('STLQuestService crash recovery', () => {
  let root: string
  let data: string
  let repository: DrizzleRepository
  let assets: LocalAssetStore
  let staging: UploadStaging
  let removeTusUpload: Mock<(uploadId: string) => Promise<void>>
  let service: STLQuestService

  beforeEach(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-service-'))
    data = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-service-data-'))
    repository = await DrizzleRepository.create(createDatabase(':memory:'))
    const now = new Date()
    for (const identity of [admin, requester, otherRequester]) {
      await repository.database
        .insert(user)
        .values({
          id: identity.id,
          name: identity.name,
          email: identity.email,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
          role: 'requester',
        })
        .run()
    }
    assets = new LocalAssetStore(root)
    staging = new UploadStaging(data)
    await Promise.all([assets.initialize(), staging.initialize()])
    removeTusUpload = vi.fn(async () => undefined)
    service = new STLQuestService(repository, assets, staging, new LocalEventBus(), telemetry, { remove: removeTusUpload })
  })

  afterEach(async () => {
    await repository.close()
    await Promise.all([fs.promises.rm(root, { recursive: true }), fs.promises.rm(data, { recursive: true })])
  })

  async function request() {
    await assets.write('todo/model.stl', new TextEncoder().encode('stl'))
    const id = await repository.createRequest({
      name: 'Model',
      fileName: 'model.stl',
      filePath: 'todo/model.stl',
      quantity: 1,
      ownerUserId: requester.id,
    })
    return id
  }

  it('finishes a delete after restarting between the filesystem and database phases', async () => {
    const id = await request()
    const failure = vi.spyOn(repository, 'deleteRequest').mockImplementationOnce(() => {
      throw new Error('database unavailable')
    })
    await expect(service.remove(id, admin)).rejects.toThrow('database unavailable')
    expect(await repository.getRequest(id)).toBeTruthy()
    expect(await repository.listOperations()).toHaveLength(1)
    failure.mockRestore()
    await service.recoverOperations()
    expect(await repository.getRequest(id)).toBeUndefined()
    expect(await repository.listOperations()).toHaveLength(0)
  })

  it('joins an already pending delete for the same request', async () => {
    const id = await request()
    const failure = vi.spyOn(repository, 'deleteRequest').mockImplementationOnce(() => {
      throw new Error('database unavailable')
    })
    await expect(service.remove(id, admin)).rejects.toThrow('database unavailable')
    failure.mockRestore()

    await expect(service.remove(id, admin)).resolves.toBeUndefined()

    expect(await repository.getRequest(id)).toBeUndefined()
    expect(await repository.listOperations()).toHaveLength(0)
    expect(await assets.exists('todo/model.stl')).toBe(false)
  })

  it('treats an already deleted request as a completed delete', async () => {
    const id = await request()
    await service.remove(id, admin)

    await expect(service.remove(id, admin)).resolves.toBeUndefined()

    expect(await repository.getRequest(id)).toBeUndefined()
    expect(await repository.listOperations()).toHaveLength(0)
  })

  it('journals original and preview assets with distinct deterministic trash paths', async () => {
    await assets.write('todo/with-preview.stl', new TextEncoder().encode('original'))
    await assets.write('previews/with-preview.stl', new TextEncoder().encode('preview'))
    const id = await repository.createRequest({
      name: 'Previewed',
      fileName: 'with-preview.stl',
      filePath: 'todo/with-preview.stl',
      previewPath: 'previews/with-preview.stl',
      quantity: 1,
      ownerUserId: requester.id,
    })
    const failure = vi.spyOn(repository, 'deleteRequest').mockImplementationOnce(() => {
      throw new Error('database unavailable')
    })
    await expect(service.remove(id, admin)).rejects.toThrow('database unavailable')
    const operation = (await repository.listOperations())[0]
    expect(operation.payload.kind).toBe('delete')
    if (operation.payload.kind === 'delete') expect(new Set(operation.payload.assets.map((asset) => asset.trashPath)).size).toBe(2)
    failure.mockRestore()
    await service.recoverOperations()
    expect(await repository.getRequest(id)).toBeUndefined()
  })

  it('does not report a logical delete as failed when trash cleanup fails', async () => {
    const id = await request()
    vi.spyOn(assets, 'purgeTrash').mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(service.remove(id, admin)).resolves.toBeUndefined()
    expect(await repository.getRequest(id)).toBeUndefined()
    expect(await repository.listOperations()).toHaveLength(1)
    await service.recoverOperations()
    expect(await repository.listOperations()).toHaveLength(0)
  })

  it('purges owned request assets before allowing account deletion', async () => {
    const id = await request()
    const uploadId = 'owned-incomplete-upload'
    await repository.createUploadSession(uploadId, requester.id, Date.now() + 60_000, 3)
    await staging.writeUploadPart(staging.uploadPart(uploadId), new TextEncoder().encode('partial stl'))

    await service.removeOwnedRequests(requester.id)

    expect(await repository.getRequest(id)).toBeUndefined()
    expect(await assets.exists('todo/model.stl')).toBe(false)
    await expect(fs.promises.access(staging.uploadPart(uploadId))).rejects.toThrow()
    expect(removeTusUpload).toHaveBeenCalledWith(uploadId)
    expect(await repository.uploadIdsOwnedBy(requester.id)).toHaveLength(0)
    expect(await repository.listOperations()).toHaveLength(0)
    await expect(repository.database.delete(user).where(eq(user.id, requester.id)).run()).resolves.not.toThrow()
  })

  it('finishes an owned pending move before deleting the account', async () => {
    const id = await request()
    await repository.beginOperation(crypto.randomUUID(), {
      kind: 'move',
      requestId: id,
      fromStatus: 'todo',
      toStatus: 'in_progress',
      count: 1,
      sourcePath: 'todo/model.stl',
      destinationPath: 'in-progress/model.stl',
    })

    await service.removeOwnedRequests(requester.id)

    expect(await repository.getRequest(id)).toBeUndefined()
    expect(await repository.listOperations()).toHaveLength(0)
    expect(await assets.exists('todo/model.stl')).toBe(false)
    expect(await assets.exists('in-progress/model.stl')).toBe(false)
  })

  it('leaves another account pending operations untouched during account deletion', async () => {
    const ownedId = await request()
    await assets.write('todo/admin-model.stl', new TextEncoder().encode('admin model'))
    const otherId = await repository.createRequest({
      name: 'Admin model',
      fileName: 'admin-model.stl',
      filePath: 'todo/admin-model.stl',
      quantity: 1,
      ownerUserId: admin.id,
    })
    const operationId = crypto.randomUUID()
    await repository.beginOperation(operationId, {
      kind: 'move',
      requestId: otherId,
      fromStatus: 'todo',
      toStatus: 'in_progress',
      count: 1,
      sourcePath: 'todo/admin-model.stl',
      destinationPath: 'in-progress/admin-model.stl',
    })

    await service.removeOwnedRequests(requester.id)

    expect(await repository.getRequest(ownedId)).toBeUndefined()
    expect(await repository.getRequest(otherId)).toMatchObject({ counts: { todo: 1, in_progress: 0 } })
    expect(await repository.listOperations()).toMatchObject([{ id: operationId }])
    expect(await assets.exists('todo/admin-model.stl')).toBe(true)
  })

  it('keeps the account and request when owned asset cleanup fails', async () => {
    const id = await request()
    const failure = vi.spyOn(assets, 'purgeTrash').mockRejectedValueOnce(new Error('storage unavailable'))

    await expect(service.removeOwnedRequests(requester.id)).rejects.toThrow('storage unavailable')

    expect(await repository.getRequest(id)).toBeTruthy()
    expect(await repository.listOperations()).toHaveLength(1)
    await expect(repository.database.delete(user).where(eq(user.id, requester.id)).run()).rejects.toThrow('FOREIGN KEY constraint failed')

    failure.mockRestore()
    await service.removeOwnedRequests(requester.id)
    expect(await repository.getRequest(id)).toBeUndefined()
    expect(await repository.listOperations()).toHaveLength(0)
  })

  it('replays a prepared move idempotently after restart', async () => {
    const id = await request()
    const operationId = crypto.randomUUID()
    await repository.beginOperation(operationId, {
      kind: 'move',
      requestId: id,
      fromStatus: 'todo',
      toStatus: 'in_progress',
      count: 1,
      sourcePath: 'todo/model.stl',
      destinationPath: 'in-progress/model.stl',
    })
    await service.recoverOperations()
    expect(await repository.getRequest(id)).toMatchObject({ filePath: 'in-progress/model.stl', counts: { todo: 0, in_progress: 1 } })
    expect(await fs.promises.readFile(assets.absolute('in-progress/model.stl'), 'utf8')).toBe('stl')
    expect(await repository.listOperations()).toHaveLength(0)
  })

  it('replays a move when the file was renamed before the process stopped', async () => {
    const id = await request()
    const operationId = crypto.randomUUID()
    await repository.beginOperation(operationId, {
      kind: 'move',
      requestId: id,
      fromStatus: 'todo',
      toStatus: 'done',
      count: 1,
      sourcePath: 'todo/model.stl',
      destinationPath: 'done/model.stl',
    })
    await assets.ensureMoved('todo/model.stl', 'done/model.stl')
    await service.recoverOperations()
    expect(await repository.getRequest(id)).toMatchObject({ filePath: 'done/model.stl', counts: { todo: 0, done: 1 } })
  })

  it('replays a pending operation before removing an old workflow status', async () => {
    const id = await request()
    await repository.database
      .update(requestStatuses)
      .set({ quantity: 0 })
      .where(
        and(eq(requestStatuses.workspaceId, 'test-workspace'), eq(requestStatuses.requestId, id), eq(requestStatuses.statusId, 'todo')),
      )
      .run()
    await repository.database
      .insert(requestStatuses)
      .values({ workspaceId: 'test-workspace', requestId: id, statusId: 'retired', quantity: 1 })
      .run()
    await assets.ensureMoved('todo/model.stl', 'retired/model.stl')
    await repository.database.update(requests).set({ filePath: 'retired/model.stl' }).where(eq(requests.id, id)).run()
    await repository.beginOperation(crypto.randomUUID(), {
      kind: 'move',
      requestId: id,
      fromStatus: 'retired',
      toStatus: 'done',
      count: 1,
      sourcePath: 'retired/model.stl',
      destinationPath: 'done/model.stl',
    })
    await expect(repository.reconcileWorkflow()).rejects.toThrow('still has copies')
    await service.recoverOperations()
    await repository.reconcileWorkflow()
    expect(await repository.getRequest(id)).toMatchObject({ counts: { todo: 0, done: 1 }, filePath: 'done/model.stl' })
    expect((await repository.getRequest(id))?.counts).not.toHaveProperty('retired')
  })

  it('filters requests to the owner in private mode and lets requesters manage their own', async () => {
    const mine = await request()
    await assets.write('todo/other.stl', new TextEncoder().encode('stl'))
    const theirs = await repository.createRequest({
      name: 'Theirs',
      fileName: 'other.stl',
      filePath: 'todo/other.stl',
      quantity: 1,
      ownerUserId: otherRequester.id,
    })

    const shared = await service.listRequests(requester, false)
    expect(shared.requests).toHaveLength(2)
    const privately = await service.listRequests(requester, true)
    expect(privately.requests).toHaveLength(1)
    expect(privately.requests[0]).toMatchObject({ id: mine, mine: true, canDelete: true })
    expect((await service.listRequests({ ...requester, email: 'renamed@example.com' }, true)).requests[0]).toMatchObject({
      id: mine,
      mine: true,
    })
    expect((await service.listRequests(admin, true)).requests).toHaveLength(2)

    capture.mockClear()
    await service.reorder(mine, 'todo', 3, requester)
    expect(capture).toHaveBeenCalledWith(requester.id, 'request_reordered', { status: 'todo' })
    await expect(service.reorder(mine, 'in_progress', 2, requester)).rejects.toThrow(expect.objectContaining({ status: 400 }))
    await expect(service.reorder(theirs, 'todo', 2, admin)).rejects.toThrow(expect.objectContaining({ status: 403 }))
    await expect(service.reorder(mine, 'todo', 4, { ...otherRequester, email: requester.email })).rejects.toThrow(
      expect.objectContaining({ status: 403 }),
    )
    await expect(service.reorder(theirs, 'todo', 3, requester)).rejects.toThrow(expect.objectContaining({ status: 403 }))
    await expect(service.remove(theirs, requester)).rejects.toMatchObject({ status: 403 })
    await service.remove(mine, requester)
    expect(await repository.getRequest(mine)).toBeUndefined()
  })

  it('exposes configured printer assignments and rejects unknown printers', async () => {
    await repository.setSetting('printers', [slaPrinter])
    const id = await repository.createRequest({
      name: 'Assigned',
      fileName: 'assigned.stl',
      filePath: 'todo/assigned.stl',
      quantity: 1,
      ownerUserId: requester.id,
      printerId: slaPrinter.id,
    })

    expect((await service.listRequests(admin)).requests).toEqual([
      expect.objectContaining({ id, printer: { id: slaPrinter.id, name: slaPrinter.name, printType: 'resin' } }),
    ])
    await expect(service.update(id, { printerId: 'missing-printer' }, admin)).rejects.toThrow(expect.objectContaining({ status: 400 }))
    await expect(service.update(id, { printerId: null }, requester)).rejects.toThrow(expect.objectContaining({ status: 403 }))
    expect(await service.update(id, { requestedPrintType: 'filament' }, requester)).toEqual({ printTypeChanged: true })
    expect(await repository.getRequest(id)).toMatchObject({ printerId: undefined, requestedPrintType: 'filament' })
  })

  it('validates assignment-first request targets', async () => {
    await repository.setSetting('printers', [slaPrinter, filamentPrinter])
    await expect(
      service.createRequest(
        {
          name: 'Conflicting target',
          fileName: 'wrong.stl',
          filePath: 'todo/wrong.stl',
          quantity: 1,
          requestedPrintType: 'filament',
          printerId: slaPrinter.id,
        },
        admin,
      ),
    ).rejects.toThrow(expect.objectContaining({ status: 400 }))

    const id = await service.createRequest(
      {
        name: 'Filament model',
        fileName: 'filament.stl',
        filePath: 'todo/filament.stl',
        quantity: 1,
        printerId: filamentPrinter.id,
      },
      admin,
    )

    expect(await repository.getRequest(id)).toMatchObject({ requestedPrintType: undefined, printerId: filamentPrinter.id })
    expect(await service.update(id, { requestedPrintType: 'filament' }, admin)).toEqual({ printTypeChanged: false })
    expect(await repository.getRequest(id)).toMatchObject({ requestedPrintType: undefined, printerId: filamentPrinter.id })
    expect(await service.update(id, { notes: 'Still filament' }, admin)).toEqual({ printTypeChanged: false })
    expect(await service.update(id, { printerId: slaPrinter.id }, admin)).toEqual({ printTypeChanged: true })
    expect(await repository.getRequest(id)).toMatchObject({ requestedPrintType: undefined, printerId: slaPrinter.id })
  })

  it('automatically assigns outstanding copies relative to build plate area', async () => {
    await repository.setSetting('printers', [slaPrinter, largeResinPrinter])
    for (const printer of [slaPrinter, largeResinPrinter]) {
      await repository.createRequest({
        name: `${printer.name} workload`,
        fileName: `${printer.id}.stl`,
        filePath: `todo/${printer.id}.stl`,
        quantity: 1,
        ownerUserId: requester.id,
        printerId: printer.id,
      })
    }

    const id = await service.createRequest(
      {
        name: 'Automatically assigned',
        fileName: 'automatic.stl',
        filePath: 'todo/automatic.stl',
        quantity: 1,
        requestedPrintType: 'resin',
      },
      requester,
    )

    expect((await repository.getRequest(id))?.printerId).toBe(largeResinPrinter.id)
  })

  it('blocks requester deletion once a copy has started', async () => {
    const id = await request()
    await service.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1 }, admin)
    await expect(service.remove(id, requester)).rejects.toMatchObject({ status: 403 })
    expect((await service.listRequests(requester, true)).requests[0]).toMatchObject({ canDelete: false })
  })

  it('lets requesters rename their own queued requests', async () => {
    const id = await request()
    await service.update(id, { name: 'Renamed model' }, requester)
    expect((await repository.getRequest(id))?.name).toBe('Renamed model')
  })

  it('returns public role-aware requests and enforces requester authorization', async () => {
    const id = await request()
    expect((await service.listRequests(requester)).requests[0]).toMatchObject({
      id: id,
      mine: true,
      canEdit: true,
      canDelete: true,
      hasPreview: false,
    })
    expect((await service.listRequests(requester)).requests[0]).not.toHaveProperty('filePath')
    expect((await service.listRequests(requester)).requests[0]).not.toHaveProperty('requesterEmail')
    await service.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1 }, admin)
    expect((await service.listRequests(requester)).requests[0]).toMatchObject({ canEdit: false, canDelete: false })
    await expect(service.update(id, { notes: 'changed' }, requester)).rejects.toThrow()
  })

  it('passes server filters through without exposing private searchable metadata to requesters', async () => {
    await request()
    expect((await service.listRequests(requester, false, { query: 'model.stl' })).requests).toHaveLength(0)
    expect((await service.listRequests(admin, false, { query: 'model.stl' })).requests).toHaveLength(1)
  })

  it('rejects oversized or malformed updates before persistence', async () => {
    const id = await request()
    await expect(service.update(id, { name: 'x'.repeat(121) }, admin)).rejects.toThrow(expect.objectContaining({ status: 400 }))
    await expect(service.update(id, { notes: 'x'.repeat(2001) }, admin)).rejects.toThrow(expect.objectContaining({ status: 400 }))
    await expect(service.update(id, { quantity: 1.5 }, admin)).rejects.toThrow(expect.objectContaining({ status: 400 }))
    await expect(service.update(id, { sourceUrl: 'ftp://example.com/model' }, admin)).rejects.toThrow(
      expect.objectContaining({ status: 400 }),
    )
    await expect(service.update(id, { sourceUrl: 'not a url' }, admin)).rejects.toThrow(expect.objectContaining({ status: 400 }))
    await expect(service.update(id, { sourceUrl: `https://example.com/${'x'.repeat(500)}` }, admin)).rejects.toThrow(
      expect.objectContaining({ status: 400 }),
    )
    await service.update(id, { sourceUrl: 'https://example.com/model' }, admin)
    expect((await repository.getRequest(id))?.sourceUrl).toBe('https://example.com/model')
    await service.update(id, { sourceUrl: '' }, admin)
    expect((await repository.getRequest(id))?.sourceUrl).toBeFalsy()
    expect((await repository.getRequest(id))?.name).toBe('Model')
  })

  it('trashes generated thumbnails alongside the original on delete', async () => {
    const id = await request()
    await assets.write('thumbnails/model.png', new TextEncoder().encode('png bytes'))
    await repository.completeAssetGeneration(id, { thumbnailPath: 'thumbnails/model.png' })
    expect((await repository.getRequest(id))!.hasThumbnail).toBe(true)
    await service.remove(id, admin)
    expect(await assets.exists('thumbnails/model.png')).toBe(false)
  })

  it('surfaces an unwritable destination instead of silently dropping the upload', async () => {
    const part = staging.uploadPart('unwritable-destination-upload')
    await fs.promises.writeFile(part, 'stl')
    const enoent = Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
    const failure = vi.spyOn(assets, 'finalizeUpload').mockRejectedValue(enoent)
    await repository.createUploadSession('unwritable-destination-upload', admin.id, Date.now() + 60_000, 3)
    await expect(
      service.createUploadedRequest(
        'unwritable-destination-upload',
        part,
        {
          name: 'Model',
          fileName: 'model.stl',
          quantity: 1,
        },
        admin,
      ),
    ).rejects.toThrow('ENOENT')
    // The staged part survives and the journal entry stays, so the upload
    // completes once storage is reachable again.
    expect(await fs.promises.readFile(part, 'utf8')).toBe('stl')
    expect(await repository.listOperations()).toHaveLength(1)
    expect(await repository.listRequests()).toHaveLength(0)
    failure.mockRestore()
    await service.recoverOperations()
    expect(await repository.listRequests()).toHaveLength(1)
  })

  it('keeps a journaled upload recoverable when metadata insertion fails', async () => {
    const part = staging.uploadPart('metadata-failure-upload')
    await fs.promises.writeFile(part, 'stl')
    const failure = vi.spyOn(repository, 'completeUploadOperation').mockImplementationOnce(() => {
      throw new Error('database full')
    })
    await repository.createUploadSession('metadata-failure-upload', admin.id, Date.now() + 60_000, 3)
    await expect(
      service.createUploadedRequest(
        'metadata-failure-upload',
        part,
        {
          name: 'Model',
          fileName: 'model.stl',
          quantity: 1,
        },
        admin,
      ),
    ).rejects.toThrow('database full')
    expect(await repository.listOperations()).toHaveLength(1)
    expect(await fs.promises.readdir(assets.absolute('models'))).toHaveLength(1)
    failure.mockRestore()
    const retried = await service.createUploadedRequest(
      'metadata-failure-upload',
      part,
      {
        name: 'Model',
        fileName: 'model.stl',
        quantity: 1,
      },
      admin,
    )
    expect(retried).toBeTruthy()
    expect(await repository.listRequests()).toHaveLength(1)
    expect(await repository.listOperations()).toHaveLength(0)
  })

  it('moves copies without touching the stored model', async () => {
    const id = await request()
    const moveAsset = vi.spyOn(assets, 'ensureMoved')

    await service.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1 }, admin)

    expect(moveAsset).not.toHaveBeenCalled()
    expect(await repository.getRequest(id)).toMatchObject({ counts: { todo: 0, in_progress: 1 }, filePath: 'todo/model.stl' })
    expect(await repository.listOperations()).toHaveLength(0)
  })

  it('recovers when the original finalize fails transiently', async () => {
    const uploadId = 'original-finalize-retry'
    const part = staging.uploadPart(uploadId)
    await fs.promises.writeFile(part, 'stl')
    await repository.createUploadSession(uploadId, admin.id, Date.now() + 60_000, 3)
    vi.spyOn(assets, 'finalizeUpload').mockRejectedValueOnce(new Error('original filesystem failure'))
    await expect(
      service.createUploadedRequest(
        uploadId,
        part,
        {
          name: 'Model',
          fileName: 'model.stl',
          quantity: 1,
        },
        admin,
      ),
    ).rejects.toThrow('original filesystem failure')
    expect(await repository.listOperations()).toHaveLength(1)
    vi.restoreAllMocks()
    await service.recoverOperations()
    expect((await repository.listRequests())[0]).toMatchObject({ name: 'Model' })
    expect(await repository.listOperations()).toHaveLength(0)
  })

  it('contains rejected optional telemetry promises', async () => {
    const rejecting: Telemetry = {
      capture: async () => {
        throw new Error('telemetry down')
      },
      exception: async () => undefined,
    }
    service = new STLQuestService(repository, assets, staging, new LocalEventBus(), rejecting, { remove: removeTusUpload })
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      await request()
      await new Promise((resolve) => setImmediate(resolve))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('terminally reconciles a stale conflicting move instead of poisoning every startup', async () => {
    const id = await request()
    await repository.beginOperation(crypto.randomUUID(), {
      kind: 'move',
      requestId: id,
      fromStatus: 'todo',
      toStatus: 'done',
      count: 1,
      sourcePath: 'todo/model.stl',
      destinationPath: 'done/model.stl',
    })
    await assets.ensureMoved('todo/model.stl', 'done/model.stl')
    await repository.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1, filePath: 'todo/model.stl' })
    await service.recoverOperations()
    expect(await repository.listOperations()).toHaveLength(0)
    expect(await fs.promises.readFile(assets.absolute('todo/model.stl'), 'utf8')).toBe('stl')
    await service.recoverOperations()
  })

  it('returns the original request for an ambiguous final-upload retry', async () => {
    const uploadId = 'ambiguous-upload-id'
    const part = staging.uploadPart(uploadId)
    await fs.promises.writeFile(part, 'stl')
    await repository.createUploadSession(uploadId, admin.id, Date.now() + 60_000, 3)
    const input = { name: 'Model', fileName: 'model.stl', quantity: 1 }
    const first = await service.createUploadedRequest(uploadId, part, input, admin)
    const second = await service.createUploadedRequest(uploadId, part, input, admin)
    expect(second).toBe(first)
    expect(await repository.listRequests()).toHaveLength(1)
  })

  it('cleans an upload journal whose staged files disappeared before startup replay', async () => {
    const uploadId = 'missing-staged-upload'
    await repository.createUploadSession(uploadId, admin.id, Date.now() + 60_000, 3)
    await repository.beginUploadOperation(crypto.randomUUID(), {
      kind: 'upload',
      uploadId,
      ownerId: admin.id,
      requestId: crypto.randomUUID(),
      partPath: staging.uploadPart(uploadId),
      destinationPath: 'todo/missing.stl',
      request: { name: 'Missing', fileName: 'missing.stl', quantity: 1, ownerUserId: admin.id },
    })
    await service.recoverOperations()
    expect(await repository.listOperations()).toHaveLength(0)
    expect(await repository.listRequests()).toHaveLength(0)
  })

  it('moves a validated batch atomically while splitting quantities between stages', async () => {
    await assets.write('todo/first.stl', new TextEncoder().encode('first'))
    await assets.write('todo/second.stl', new TextEncoder().encode('second'))
    const first = await repository.createRequest({
      name: 'First',
      fileName: 'first.stl',
      filePath: 'todo/first.stl',
      quantity: 3,
      ownerUserId: requester.id,
    })
    const second = await repository.createRequest({
      name: 'Second',
      fileName: 'second.stl',
      filePath: 'todo/second.stl',
      quantity: 2,
      ownerUserId: requester.id,
    })

    capture.mockClear()
    await service.moveCopiesBatch(
      [
        { id: first, from: 'todo', to: 'up_next', count: 2 },
        { id: second, from: 'todo', to: 'up_next', count: 2 },
      ],
      admin,
    )

    expect((await repository.getRequest(first))?.counts).toMatchObject({ todo: 1, up_next: 2 })
    expect((await repository.getRequest(second))?.counts).toMatchObject({ todo: 0, up_next: 2 })
    expect(capture).toHaveBeenCalledWith(admin.id, 'request_batch_moved', {
      request_count: 2,
      copy_count: 4,
      from_statuses: ['todo'],
      to_statuses: ['up_next'],
      print_types: [],
    })
  })

  it('keeps prepared copies grouped when moving a print group', async () => {
    await assets.write('todo/first.stl', new TextEncoder().encode('first'))
    await assets.write('todo/second.stl', new TextEncoder().encode('second'))
    const first = await repository.createRequest({
      name: 'First',
      fileName: 'first.stl',
      filePath: 'todo/first.stl',
      quantity: 3,
      ownerUserId: requester.id,
    })
    const second = await repository.createRequest({
      name: 'Second',
      fileName: 'second.stl',
      filePath: 'todo/second.stl',
      quantity: 1,
      ownerUserId: requester.id,
    })
    await service.moveCopiesBatch(
      [
        { id: first, from: 'todo', to: 'up_next', count: 2 },
        { id: second, from: 'todo', to: 'up_next', count: 1 },
      ],
      admin,
    )
    const groupId = await service.createGroup(
      {
        name: 'Dragon plate',
        status: 'up_next',
        items: [
          { requestId: first, count: 2 },
          { requestId: second, count: 1 },
        ],
      },
      admin,
    )

    capture.mockClear()
    await service.moveGroup(groupId, 'in_progress', admin)

    expect((await repository.getGroup(groupId))?.status).toBe('in_progress')
    expect((await repository.getRequest(first))?.counts).toMatchObject({ todo: 1, up_next: 0, in_progress: 2 })
    expect((await repository.getRequest(second))?.counts).toMatchObject({ up_next: 0, in_progress: 1 })
    expect(capture).toHaveBeenCalledWith(admin.id, 'print_group_moved', {
      from_status: 'up_next',
      to_status: 'in_progress',
      item_count: 2,
      copy_count: 3,
    })
  })

  it('does not move copies reserved by a print group individually', async () => {
    const id = await request()
    await service.createGroup({ name: 'Reserved plate', status: 'todo', items: [{ requestId: id, count: 1 }] }, admin)

    await expect(service.moveCopies({ id, from: 'todo', to: 'up_next', count: 1 }, admin)).rejects.toMatchObject({ status: 409 })
  })

  it('assigns the next available default group name', async () => {
    const first = await service.createGroup({ status: 'todo', items: [] }, admin)
    const second = await service.createGroup({ status: 'up_next', items: [] }, admin)

    expect([(await repository.getGroup(first))?.name, (await repository.getGroup(second))?.name]).toEqual(['Group 1', 'Group 2'])
    expect([(await repository.getGroup(first))?.color, (await repository.getGroup(second))?.color]).toEqual(['blue', 'green'])
  })

  it('uses every group color before repeating one', async () => {
    const groups: string[] = []
    for (let index = 0; index < 13; index++) groups.push(await service.createGroup({ status: 'todo', items: [] }, admin))
    const colors = await Promise.all(groups.map(async (id) => (await repository.getGroup(id))?.color))

    expect(new Set(colors.slice(0, 12))).toHaveLength(12)
    expect(colors[12]).toBe(colors[0])
  })

  it('adds, transfers, and removes prints from groups', async () => {
    const id = await request()
    const first = await service.createGroup({ name: 'First plate', status: 'todo', items: [] }, admin)
    const second = await service.createGroup({ name: 'Second plate', status: 'todo', items: [] }, admin)

    capture.mockClear()
    await service.moveGroupItem({ requestId: id, count: 1, status: 'todo', toGroupId: first }, admin)
    await service.moveGroupItem({ requestId: id, count: 1, status: 'todo', fromGroupId: first, toGroupId: second }, admin)
    await service.moveGroupItem({ requestId: id, count: 1, status: 'todo', fromGroupId: second }, admin)

    expect((await repository.getGroup(first))?.items).toEqual([])
    expect((await repository.getGroup(second))?.items).toEqual([])
    expect(capture.mock.calls).toEqual([
      [admin.id, 'print_group_item_changed', { action: 'added', copy_count: 1 }],
      [admin.id, 'print_group_item_changed', { action: 'transferred', copy_count: 1 }],
      [admin.id, 'print_group_item_changed', { action: 'removed', copy_count: 1 }],
    ])
  })

  it('does not add more ungrouped copies than are available', async () => {
    const id = await request()
    const group = await service.createGroup({ name: 'Plate', status: 'todo', items: [{ requestId: id, count: 1 }] }, admin)

    await expect(service.moveGroupItem({ requestId: id, count: 1, status: 'todo', toGroupId: group }, admin)).rejects.toThrowError(
      expect.objectContaining({ status: 409 }),
    )
  })

  it('does not reduce a request below the copies reserved by a group', async () => {
    const id = await repository.createRequest({
      name: 'Grouped model',
      fileName: 'grouped.stl',
      filePath: 'grouped.stl',
      quantity: 3,
      ownerUserId: requester.id,
    })
    await service.createGroup({ status: 'todo', items: [{ requestId: id, count: 2 }] }, admin)

    await expect(service.update(id, { quantity: 1 }, requester)).rejects.toThrow(expect.objectContaining({ status: 409 }))
    await expect(service.removeCopiesBatch([{ id, status: 'todo', count: 2 }], admin)).rejects.toMatchObject({ status: 409 })
    expect((await repository.getRequest(id))?.quantity).toBe(3)
  })

  it('enforces ungrouped availability inside the repository transaction', async () => {
    const id = await request()
    const first = await service.createGroup({ status: 'todo', items: [{ requestId: id, count: 1 }] }, admin)
    const second = await service.createGroup({ status: 'todo', items: [] }, admin)

    await expect(repository.moveGroupItem(id, 1, 'todo', undefined, second)).rejects.toThrow(expect.objectContaining({ status: 409 }))
    expect((await repository.getGroup(first))?.items).toEqual([{ requestId: id, count: 1, order: 0 }])
    expect((await repository.getGroup(second))?.items).toEqual([])
  })

  it('removes a print from its group while moving it to another stage', async () => {
    const id = await request()
    const group = await service.createGroup({ name: 'Plate', status: 'todo', items: [{ requestId: id, count: 1 }] }, admin)

    await service.moveGroupItem({ requestId: id, count: 1, status: 'todo', fromGroupId: group, toStatus: 'up_next' }, admin)

    expect((await repository.getGroup(group))?.items).toEqual([])
    expect((await repository.getRequest(id))?.counts).toMatchObject({ todo: 0, up_next: 1 })
  })

  it('moves an ungrouped print into a group in another stage', async () => {
    const id = await request()
    const group = await service.createGroup({ name: 'Prepared plate', status: 'up_next', items: [] }, admin)

    await service.moveGroupItem({ requestId: id, count: 1, status: 'todo', toStatus: 'up_next', toGroupId: group }, admin)

    expect((await repository.getGroup(group))?.items).toEqual([{ requestId: id, count: 1, order: 0 }])
    expect((await repository.getRequest(id))?.counts).toMatchObject({ todo: 0, up_next: 1 })
  })

  it('renames and deletes a group without deleting its prints', async () => {
    const id = await request()
    capture.mockClear()
    const group = await service.createGroup({ name: 'Original plate', status: 'todo', items: [{ requestId: id, count: 1 }] }, admin)

    await service.renameGroup(group, 'Updated plate', admin)
    expect((await repository.getGroup(group))?.name).toBe('Updated plate')

    await service.deleteGroup(group, admin)
    expect(await repository.getGroup(group)).toBeUndefined()
    expect((await repository.getRequest(id))?.counts.todo).toBe(1)
    expect(capture.mock.calls).toEqual([
      [admin.id, 'print_group_created', { item_count: 1, copy_count: 1 }],
      [admin.id, 'print_group_renamed', undefined],
      [admin.id, 'print_group_deleted', { item_count: 1, copy_count: 1 }],
    ])
  })

  it('reorders prints inside a group', async () => {
    const first = await request()
    const second = await repository.createRequest({
      name: 'Second',
      fileName: 'second.stl',
      filePath: 'second.stl',
      quantity: 1,
      ownerUserId: requester.id,
    })
    const group = await service.createGroup(
      {
        name: 'Ordered plate',
        status: 'todo',
        items: [
          { requestId: first, count: 1 },
          { requestId: second, count: 1 },
        ],
      },
      admin,
    )

    await service.reorderGroupItem(group, second, first, 'before', admin)

    expect((await repository.getGroup(group))?.items.map((item) => item.requestId)).toEqual([second, first])
  })

  it('leaves every request unchanged when any batch move is invalid', async () => {
    const first = await request()
    const second = await repository.createRequest({
      name: 'Second',
      fileName: 'second.stl',
      filePath: 'todo/second.stl',
      quantity: 1,
      ownerUserId: requester.id,
    })

    await expect(
      service.moveCopiesBatch(
        [
          { id: first, from: 'todo', to: 'up_next', count: 1 },
          { id: second, from: 'todo', to: 'up_next', count: 2 },
        ],
        admin,
      ),
    ).rejects.toMatchObject({ status: 409 })
    expect((await repository.getRequest(first))?.counts).toMatchObject({ todo: 1, up_next: 0 })
  })

  it('rolls staged assets back when the batch database commit fails', async () => {
    const id = await request()
    vi.spyOn(repository, 'moveCopiesBatch').mockImplementationOnce(() => {
      throw new Error('database unavailable')
    })

    await expect(service.moveCopiesBatch([{ id, from: 'todo', to: 'done', count: 1 }], admin)).rejects.toThrow('database unavailable')
    expect(await assets.exists('todo/model.stl')).toBe(true)
    expect((await repository.getRequest(id))?.counts).toMatchObject({ todo: 1, done: 0 })
  })

  it('requires an administrator for batch moves and deletion', async () => {
    const id = await request()
    await expect(service.moveCopiesBatch([{ id, from: 'todo', to: 'done', count: 1 }], requester)).rejects.toMatchObject({
      status: 403,
    })
    await expect(service.removeCopiesBatch([{ id, status: 'todo', count: 1 }], requester)).rejects.toMatchObject({ status: 403 })
  })

  it('cannot batch-mutate requests from another workspace', async () => {
    await repository.listRequests()
    await repository.database
      .insert(organization)
      .values({ id: 'other-workspace', name: 'Other', slug: 'other', createdAt: new Date() })
      .run()
    const other = await repository.scoped('other-workspace')
    const id = await other.createRequest({
      name: 'Other',
      fileName: 'other.stl',
      filePath: 'todo/other.stl',
      quantity: 1,
      ownerUserId: requester.id,
    })

    await expect(service.moveCopiesBatch([{ id, from: 'todo', to: 'done', count: 1 }], admin)).rejects.toMatchObject({ status: 404 })
    await expect(service.removeCopiesBatch([{ id, status: 'todo', count: 1 }], admin)).rejects.toMatchObject({ status: 404 })
    expect(await other.getRequest(id)).toBeTruthy()
  })

  it('deletes a complete request batch', async () => {
    const first = await request()
    await assets.write('todo/second.stl', new TextEncoder().encode('second'))
    const second = await repository.createRequest({
      name: 'Second',
      fileName: 'second.stl',
      filePath: 'todo/second.stl',
      quantity: 2,
      ownerUserId: requester.id,
    })

    capture.mockClear()
    await service.removeCopiesBatch(
      [
        { id: first, status: 'todo', count: 1 },
        { id: second, status: 'todo', count: 2 },
      ],
      admin,
    )

    expect(await repository.listRequests()).toHaveLength(0)
    expect(capture).toHaveBeenCalledWith(admin.id, 'request_batch_deleted', {
      request_count: 2,
      copy_count: 3,
      deleted_request_count: 2,
      from_statuses: ['todo'],
      print_types: [],
    })
  })

  it('does not wait for permanent trash cleanup before completing a batch deletion', async () => {
    const id = await request()
    let startCleanup: (() => void) | undefined
    const cleanupStarted = new Promise<void>((resolve) => (startCleanup = resolve))
    vi.spyOn(assets, 'purgeTrash').mockImplementation(async () => {
      startCleanup?.()
      await new Promise(() => undefined)
    })

    await service.removeCopiesBatch([{ id, status: 'todo', count: 1 }], admin)

    await cleanupStarted
    expect(await repository.getRequest(id)).toBeUndefined()
  })

  it('stages batch assets concurrently', async () => {
    const first = await request()
    await assets.write('todo/second.stl', new TextEncoder().encode('second'))
    const second = await repository.createRequest({
      name: 'Second',
      fileName: 'second.stl',
      filePath: 'todo/second.stl',
      quantity: 1,
      ownerUserId: requester.id,
    })
    const ensureMoved = vi.spyOn(assets, 'ensureMoved')
    let releaseMoves: (() => void) | undefined
    const movesReleased = new Promise<void>((resolve) => (releaseMoves = resolve))
    ensureMoved.mockImplementation(async () => movesReleased)

    const deletion = service.removeCopiesBatch(
      [
        { id: first, status: 'todo', count: 1 },
        { id: second, status: 'todo', count: 1 },
      ],
      admin,
    )
    await vi.waitFor(() => expect(ensureMoved).toHaveBeenCalledTimes(2))
    releaseMoves?.()
    await deletion
  })

  it('restores every asset when a batch deletion cannot commit', async () => {
    const id = await request()
    vi.spyOn(repository, 'deleteCopiesBatch').mockImplementationOnce(() => {
      throw new Error('database unavailable')
    })

    await expect(service.removeCopiesBatch([{ id, status: 'todo', count: 1 }], admin)).rejects.toThrow('database unavailable')
    expect(await repository.getRequest(id)).toBeTruthy()
    expect(await assets.exists('todo/model.stl')).toBe(true)
  })

  it('deletes only copies in the selected stage', async () => {
    await assets.write('todo/split.stl', new TextEncoder().encode('split'))
    const id = await repository.createRequest({
      name: 'Split',
      fileName: 'split.stl',
      filePath: 'todo/split.stl',
      quantity: 3,
      ownerUserId: requester.id,
    })
    await service.moveCopies({ id, from: 'todo', to: 'in_progress', count: 2 }, admin)

    await service.removeCopiesBatch([{ id, status: 'in_progress', count: 2 }], admin)

    expect(await repository.getRequest(id)).toMatchObject({ quantity: 1, counts: { todo: 1, in_progress: 0 } })
    expect(await assets.exists('todo/split.stl')).toBe(true)
  })

  it('deletes copies without a raw error when the model file is already gone from storage', async () => {
    const id = await request()
    await assets.remove('todo/model.stl')

    await expect(service.removeCopiesBatch([{ id, status: 'todo', count: 1 }], admin)).resolves.toBeUndefined()

    expect(await repository.getRequest(id)).toBeUndefined()
    expect(await repository.listOperations()).toHaveLength(0)
  })

  it('completes a pending move without a raw error when the model file is already gone from storage', async () => {
    const id = await request()
    await assets.remove('todo/model.stl')
    await repository.beginOperation(crypto.randomUUID(), {
      kind: 'move',
      requestId: id,
      fromStatus: 'todo',
      toStatus: 'in_progress',
      count: 1,
      sourcePath: 'todo/model.stl',
      destinationPath: 'in-progress/model.stl',
    })

    await expect(service.recoverOperations()).resolves.toBeUndefined()

    expect(await repository.listOperations()).toHaveLength(0)
    expect(await repository.getRequest(id)).toMatchObject({ counts: { todo: 0, in_progress: 1 } })
  })
})
