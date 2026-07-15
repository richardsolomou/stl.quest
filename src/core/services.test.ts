import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { LocalAssetStore } from '../adapters/filesystem'
import { UploadStaging } from '../adapters/staging'
import { LocalEventBus } from '../adapters/events'
import { SqliteRepository } from '../adapters/sqlite'
import { createDatabase } from '../db'
import { requests, requestStatuses, user } from '../db/schema'
import type { Identity, Telemetry } from './types'
import { PrintHubService } from './services'
import type { PrinterProfile } from './platePlanner'

const telemetry: Telemetry = { capture: async () => undefined, exception: async () => undefined }
const admin: Identity = { id: 'admin', email: 'op@example.com', name: 'Admin', role: 'admin' }
const requester: Identity = { id: 'requester', email: 'owner@example.com', name: 'Owner', role: 'requester' }
const otherRequester: Identity = { id: 'other-requester', email: 'someone-else@example.com', name: 'Someone Else', role: 'requester' }
const slaPrinter: PrinterProfile = {
  id: 'sla-printer',
  name: 'Elegoo Saturn',
  printType: 'resin',
  enabled: true,
  widthMm: 192,
  depthMm: 120,
  heightMm: 200,
  spacingMm: 5,
  supportMarginMm: 4,
  adhesionMarginMm: 2,
  heightAllowanceMm: 5,
  maxHeightDifferenceMm: 20,
}
const filamentPrinter = {
  id: 'filament-printer',
  name: 'Prusa MK4',
  printType: 'filament',
  enabled: true,
  widthMm: 250,
  depthMm: 210,
  heightMm: 220,
  spacingMm: 3,
  brimMarginMm: 2,
  filamentDiameterMm: 1.75,
  materialDensityGPerCm3: 1.24,
} satisfies PrinterProfile

describe('PrintHubService crash recovery', () => {
  let root: string
  let data: string
  let repository: SqliteRepository
  let assets: LocalAssetStore
  let staging: UploadStaging
  let removeTusUpload: Mock<(uploadId: string) => Promise<void>>
  let service: PrintHubService

  beforeEach(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-service-'))
    data = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-service-data-'))
    repository = new SqliteRepository(createDatabase(':memory:'))
    const now = new Date()
    for (const identity of [admin, requester, otherRequester]) {
      repository.database
        .insert(user)
        .values({
          id: identity.id,
          name: identity.name,
          email: identity.email,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
          role: identity.role,
        })
        .run()
    }
    assets = new LocalAssetStore(root)
    staging = new UploadStaging(data)
    await Promise.all([assets.initialize(), staging.initialize()])
    removeTusUpload = vi.fn(async () => undefined)
    service = new PrintHubService(repository, assets, staging, new LocalEventBus(), telemetry, { remove: removeTusUpload })
  })

  afterEach(async () => {
    repository.close()
    await Promise.all([fs.promises.rm(root, { recursive: true }), fs.promises.rm(data, { recursive: true })])
  })

  async function request() {
    await assets.write('todo/model.stl', new TextEncoder().encode('stl'))
    const id = repository.createRequest({
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
    expect(repository.getRequest(id)).toBeTruthy()
    expect(repository.listOperations()).toHaveLength(1)
    failure.mockRestore()
    await service.recoverOperations()
    expect(repository.getRequest(id)).toBeUndefined()
    expect(repository.listOperations()).toHaveLength(0)
  })

  it('journals original and preview assets with distinct deterministic trash paths', async () => {
    await assets.write('todo/with-preview.stl', new TextEncoder().encode('original'))
    await assets.write('.printhub/previews/with-preview.stl', new TextEncoder().encode('preview'))
    const id = repository.createRequest({
      name: 'Previewed',
      fileName: 'with-preview.stl',
      filePath: 'todo/with-preview.stl',
      previewPath: '.printhub/previews/with-preview.stl',
      quantity: 1,
      ownerUserId: requester.id,
    })
    const failure = vi.spyOn(repository, 'deleteRequest').mockImplementationOnce(() => {
      throw new Error('database unavailable')
    })
    await expect(service.remove(id, admin)).rejects.toThrow('database unavailable')
    const operation = repository.listOperations()[0]
    expect(operation.payload.kind).toBe('delete')
    if (operation.payload.kind === 'delete') expect(new Set(operation.payload.assets.map((asset) => asset.trashPath)).size).toBe(2)
    failure.mockRestore()
    await service.recoverOperations()
    expect(repository.getRequest(id)).toBeUndefined()
  })

  it('does not report a logical delete as failed when trash cleanup fails', async () => {
    const id = await request()
    vi.spyOn(assets, 'purgeTrash').mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(service.remove(id, admin)).resolves.toBeUndefined()
    expect(repository.getRequest(id)).toBeUndefined()
    expect(repository.listOperations()).toHaveLength(1)
    await service.recoverOperations()
    expect(repository.listOperations()).toHaveLength(0)
  })

  it('purges owned request assets before allowing account deletion', async () => {
    const id = await request()
    const uploadId = 'owned-incomplete-upload'
    repository.createUploadSession(uploadId, requester.id, Date.now() + 60_000, 3)
    await staging.writeUploadPart(staging.uploadPart(uploadId), new TextEncoder().encode('partial stl'))

    await service.removeOwnedRequests(requester.id)

    expect(repository.getRequest(id)).toBeUndefined()
    expect(await assets.exists('todo/model.stl')).toBe(false)
    await expect(fs.promises.access(staging.uploadPart(uploadId))).rejects.toThrow()
    expect(removeTusUpload).toHaveBeenCalledWith(uploadId)
    expect(repository.uploadIdsOwnedBy(requester.id)).toHaveLength(0)
    expect(repository.listOperations()).toHaveLength(0)
    expect(() => repository.database.delete(user).where(eq(user.id, requester.id)).run()).not.toThrow()
  })

  it('finishes an owned pending move before deleting the account', async () => {
    const id = await request()
    repository.beginOperation(crypto.randomUUID(), {
      kind: 'move',
      requestId: id,
      fromStatus: 'todo',
      toStatus: 'in_progress',
      count: 1,
      sourcePath: 'todo/model.stl',
      destinationPath: 'in-progress/model.stl',
    })

    await service.removeOwnedRequests(requester.id)

    expect(repository.getRequest(id)).toBeUndefined()
    expect(repository.listOperations()).toHaveLength(0)
    expect(await assets.exists('todo/model.stl')).toBe(false)
    expect(await assets.exists('in-progress/model.stl')).toBe(false)
  })

  it('keeps the account and request when owned asset cleanup fails', async () => {
    const id = await request()
    const failure = vi.spyOn(assets, 'purgeTrash').mockRejectedValueOnce(new Error('storage unavailable'))

    await expect(service.removeOwnedRequests(requester.id)).rejects.toThrow('storage unavailable')

    expect(repository.getRequest(id)).toBeTruthy()
    expect(repository.listOperations()).toHaveLength(1)
    expect(() => repository.database.delete(user).where(eq(user.id, requester.id)).run()).toThrow('FOREIGN KEY constraint failed')

    failure.mockRestore()
    await service.removeOwnedRequests(requester.id)
    expect(repository.getRequest(id)).toBeUndefined()
    expect(repository.listOperations()).toHaveLength(0)
  })

  it('replays a prepared move idempotently after restart', async () => {
    const id = await request()
    const operationId = crypto.randomUUID()
    repository.beginOperation(operationId, {
      kind: 'move',
      requestId: id,
      fromStatus: 'todo',
      toStatus: 'in_progress',
      count: 1,
      sourcePath: 'todo/model.stl',
      destinationPath: 'in-progress/model.stl',
    })
    await service.recoverOperations()
    expect(repository.getRequest(id)).toMatchObject({ filePath: 'in-progress/model.stl', counts: { todo: 0, in_progress: 1 } })
    expect(await fs.promises.readFile(assets.absolute('in-progress/model.stl'), 'utf8')).toBe('stl')
    expect(repository.listOperations()).toHaveLength(0)
  })

  it('replays a move when the file was renamed before the process stopped', async () => {
    const id = await request()
    const operationId = crypto.randomUUID()
    repository.beginOperation(operationId, {
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
    expect(repository.getRequest(id)).toMatchObject({ filePath: 'done/model.stl', counts: { todo: 0, done: 1 } })
  })

  it('replays a pending operation before removing an old workflow status', async () => {
    const id = await request()
    repository.database
      .update(requestStatuses)
      .set({ quantity: 0 })
      .where(and(eq(requestStatuses.requestId, id), eq(requestStatuses.statusId, 'todo')))
      .run()
    repository.database.insert(requestStatuses).values({ requestId: id, statusId: 'retired', quantity: 1 }).run()
    await assets.ensureMoved('todo/model.stl', 'retired/model.stl')
    repository.database.update(requests).set({ filePath: 'retired/model.stl' }).where(eq(requests.id, id)).run()
    repository.beginOperation(crypto.randomUUID(), {
      kind: 'move',
      requestId: id,
      fromStatus: 'retired',
      toStatus: 'done',
      count: 1,
      sourcePath: 'retired/model.stl',
      destinationPath: 'done/model.stl',
    })
    expect(() => repository.reconcileWorkflow()).toThrow('still has copies')
    await service.recoverOperations()
    repository.reconcileWorkflow()
    expect(repository.getRequest(id)).toMatchObject({ counts: { todo: 0, done: 1 }, filePath: 'done/model.stl' })
    expect(repository.getRequest(id)?.counts).not.toHaveProperty('retired')
  })

  it('filters requests to the owner in private mode and lets requesters manage their own', async () => {
    const mine = await request()
    await assets.write('todo/other.stl', new TextEncoder().encode('stl'))
    const theirs = repository.createRequest({
      name: 'Theirs',
      fileName: 'other.stl',
      filePath: 'todo/other.stl',
      quantity: 1,
      ownerUserId: otherRequester.id,
    })

    const shared = service.listRequests(requester, false)
    expect(shared.requests).toHaveLength(2)
    const privately = service.listRequests(requester, true)
    expect(privately.requests).toHaveLength(1)
    expect(privately.requests[0]).toMatchObject({ id: mine, mine: true, canDelete: true })
    expect(service.listRequests({ ...requester, email: 'renamed@example.com' }, true).requests[0]).toMatchObject({ id: mine, mine: true })
    expect(service.listRequests(admin, true).requests).toHaveLength(2)

    service.reorder(mine, 'todo', 3, requester)
    expect(() => service.reorder(mine, 'todo', 4, { ...otherRequester, email: requester.email })).toThrow(
      expect.objectContaining({ status: 403 }),
    )
    expect(() => service.reorder(theirs, 'todo', 3, requester)).toThrow(expect.objectContaining({ status: 403 }))
    await expect(service.remove(theirs, requester)).rejects.toMatchObject({ status: 403 })
    await service.remove(mine, requester)
    expect(repository.getRequest(mine)).toBeUndefined()
  })

  it('exposes configured printer assignments and rejects unknown printers', async () => {
    repository.setSetting('plate-planner-profiles', [slaPrinter])
    const id = repository.createRequest({
      name: 'Assigned',
      fileName: 'assigned.stl',
      filePath: 'todo/assigned.stl',
      quantity: 1,
      ownerUserId: requester.id,
      printerId: slaPrinter.id,
    })

    expect(service.listRequests(admin).requests).toEqual([
      expect.objectContaining({ id, printer: { id: slaPrinter.id, name: slaPrinter.name, printType: 'resin', enabled: true } }),
    ])
    expect(() => service.update(id, { printerId: 'missing-printer' }, admin)).toThrow(expect.objectContaining({ status: 400 }))
  })

  it('validates assignment-first request targets', () => {
    repository.setSetting('plate-planner-profiles', [slaPrinter, filamentPrinter])
    expect(() =>
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
    ).toThrow(expect.objectContaining({ status: 400 }))

    const id = service.createRequest(
      {
        name: 'Filament model',
        fileName: 'filament.stl',
        filePath: 'todo/filament.stl',
        quantity: 1,
        printerId: filamentPrinter.id,
      },
      admin,
    )

    expect(repository.getRequest(id)).toMatchObject({ requestedPrintType: undefined, printerId: filamentPrinter.id })
    expect(service.update(id, { requestedPrintType: 'filament' }, admin)).toEqual({ printTypeChanged: false })
    expect(repository.getRequest(id)).toMatchObject({ requestedPrintType: 'filament', printerId: undefined })
    expect(service.update(id, { notes: 'Still filament' }, admin)).toEqual({ printTypeChanged: false })
    expect(service.update(id, { printerId: slaPrinter.id }, admin)).toEqual({ printTypeChanged: true })
    expect(repository.getRequest(id)).toMatchObject({ requestedPrintType: undefined, printerId: slaPrinter.id })
  })

  it('keeps existing disabled assignments but rejects new ones', () => {
    const disabled = { ...filamentPrinter, enabled: false }
    repository.setSetting('plate-planner-profiles', [slaPrinter, disabled])
    const assigned = repository.createRequest({
      name: 'Existing assignment',
      fileName: 'existing.stl',
      filePath: 'todo/existing.stl',
      quantity: 1,
      ownerUserId: requester.id,
      printerId: disabled.id,
    })
    const unassigned = repository.createRequest({
      name: 'Pool request',
      fileName: 'pool.stl',
      filePath: 'todo/pool.stl',
      quantity: 1,
      ownerUserId: requester.id,
      requestedPrintType: 'filament',
    })

    expect(service.update(assigned, { notes: 'Allowed' }, admin)).toEqual({ printTypeChanged: false })
    expect(() => service.update(unassigned, { printerId: disabled.id }, admin)).toThrow(expect.objectContaining({ status: 400 }))
  })

  it('only exposes pooled filament assumptions when enabled printers agree', () => {
    const second = { ...filamentPrinter, id: 'second-filament', name: 'Second filament printer' }
    repository.setSetting('plate-planner-profiles', [filamentPrinter, second])
    const pooledRequest = repository.createRequest({
      name: 'Filament pool',
      fileName: 'pool.stl',
      filePath: 'todo/pool.stl',
      quantity: 1,
      ownerUserId: requester.id,
      requestedPrintType: 'filament',
    })

    expect(service.listRequests(admin).requests.find(({ id }) => id === pooledRequest)?.filamentAssumptions).toEqual({
      materialDensityGPerCm3: 1.24,
    })

    repository.setSetting('plate-planner-profiles', [{ ...filamentPrinter, filamentDiameterMm: 2.85 }, second])
    expect(service.listRequests(admin).requests.find(({ id }) => id === pooledRequest)?.filamentAssumptions).toEqual({
      materialDensityGPerCm3: 1.24,
    })

    repository.setSetting('plate-planner-profiles', [{ ...filamentPrinter, materialDensityGPerCm3: 1.3 }, second])
    expect(service.listRequests(admin).requests.find(({ id }) => id === pooledRequest)?.filamentAssumptions).toBeUndefined()
  })

  it('reports compatibility across configured printers after analysis', () => {
    repository.setSetting('plate-planner-profiles', [slaPrinter, filamentPrinter])
    const id = service.createRequest(
      {
        name: 'Filament model',
        fileName: 'filament.stl',
        filePath: 'todo/filament.stl',
        quantity: 1,
        printerId: filamentPrinter.id,
      },
      admin,
    )

    expect(service.listRequests(admin).requests[0]).toMatchObject({ fitState: 'pending' })
    repository.upsertPlateModelAnalyses([
      { requestId: id, analysisVersion: 7, widthMm: 100, depthMm: 80, heightMm: 50, estimatedVolumeMm3: 10_000 },
    ])
    expect(service.listRequests(admin).requests[0]).toMatchObject({
      compatiblePrinterIds: [filamentPrinter.id],
      fitState: 'selected_printer',
    })
    repository.upsertPlateModelAnalyses([
      { requestId: id, analysisVersion: 7, widthMm: 300, depthMm: 280, heightMm: 250, estimatedVolumeMm3: 10_000 },
    ])
    expect(service.listRequests(admin).requests[0]).toMatchObject({ compatiblePrinterIds: [], fitState: 'none' })
  })

  it('does not report a bad assignment for requests targeting any compatible printer', () => {
    repository.setSetting('plate-planner-profiles', [filamentPrinter])
    const id = service.createRequest(
      {
        name: 'Pooled filament model',
        fileName: 'pooled-filament.stl',
        filePath: 'todo/pooled-filament.stl',
        quantity: 1,
        requestedPrintType: 'filament',
      },
      admin,
    )
    repository.upsertPlateModelAnalyses([
      { requestId: id, analysisVersion: 7, widthMm: 100, depthMm: 80, heightMm: 50, estimatedVolumeMm3: 10_000 },
    ])

    expect(service.listRequests(admin).requests[0]).toMatchObject({
      compatiblePrinterIds: [filamentPrinter.id],
      fitState: undefined,
    })
  })

  it('blocks requester deletion once a copy has started', async () => {
    const id = await request()
    await service.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1 }, admin)
    await expect(service.remove(id, requester)).rejects.toMatchObject({ status: 403 })
    expect(service.listRequests(requester, true).requests[0]).toMatchObject({ canDelete: false })
  })

  it('returns public role-aware requests and enforces requester authorization', async () => {
    const id = await request()
    expect(service.listRequests(requester).requests[0]).toMatchObject({
      id: id,
      mine: true,
      canEdit: true,
      canDelete: true,
      hasPreview: false,
    })
    expect(service.listRequests(requester).requests[0]).not.toHaveProperty('filePath')
    expect(service.listRequests(requester).requests[0]).not.toHaveProperty('requesterEmail')
    await service.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1 }, admin)
    expect(service.listRequests(requester).requests[0]).toMatchObject({ canEdit: false, canDelete: false })
    expect(() => service.update(id, { notes: 'changed' }, requester)).toThrow()
  })

  it('passes server filters through without exposing private searchable metadata to requesters', async () => {
    await request()
    expect(service.listRequests(requester, false, { query: 'model.stl' }).requests).toHaveLength(0)
    expect(service.listRequests(admin, false, { query: 'model.stl' }).requests).toHaveLength(1)
  })

  it('rejects oversized or malformed updates before persistence', async () => {
    const id = await request()
    expect(() => service.update(id, { name: 'x'.repeat(121) }, admin)).toThrow(expect.objectContaining({ status: 400 }))
    expect(() => service.update(id, { notes: 'x'.repeat(2001) }, admin)).toThrow(expect.objectContaining({ status: 400 }))
    expect(() => service.update(id, { quantity: 1.5 }, admin)).toThrow(expect.objectContaining({ status: 400 }))
    expect(() => service.update(id, { sourceUrl: 'ftp://example.com/model' }, admin)).toThrow(expect.objectContaining({ status: 400 }))
    expect(() => service.update(id, { sourceUrl: 'not a url' }, admin)).toThrow(expect.objectContaining({ status: 400 }))
    expect(() => service.update(id, { sourceUrl: `https://example.com/${'x'.repeat(500)}` }, admin)).toThrow(
      expect.objectContaining({ status: 400 }),
    )
    service.update(id, { sourceUrl: 'https://example.com/model' }, admin)
    expect(repository.getRequest(id)?.sourceUrl).toBe('https://example.com/model')
    service.update(id, { sourceUrl: '' }, admin)
    expect(repository.getRequest(id)?.sourceUrl).toBeFalsy()
    expect(repository.getRequest(id)?.name).toBe('Model')
  })

  it('trashes generated thumbnails alongside the original on delete', async () => {
    const id = await request()
    await assets.write('.printhub/thumbnails/model.png', new TextEncoder().encode('png bytes'))
    repository.completeAssetGeneration(id, { thumbnailPath: '.printhub/thumbnails/model.png' })
    expect(repository.getRequest(id)!.hasThumbnail).toBe(true)
    await service.remove(id, admin)
    expect(await assets.exists('.printhub/thumbnails/model.png')).toBe(false)
  })

  it('surfaces an unwritable destination instead of silently dropping the upload', async () => {
    const part = staging.uploadPart('unwritable-destination-upload')
    await fs.promises.writeFile(part, 'stl')
    const enoent = Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
    const failure = vi.spyOn(assets, 'finalizeUpload').mockRejectedValue(enoent)
    repository.createUploadSession('unwritable-destination-upload', admin.id, Date.now() + 60_000, 3)
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
    expect(repository.listOperations()).toHaveLength(1)
    expect(repository.listRequests()).toHaveLength(0)
    failure.mockRestore()
    await service.recoverOperations()
    expect(repository.listRequests()).toHaveLength(1)
  })

  it('keeps a journaled upload recoverable when metadata insertion fails', async () => {
    const part = staging.uploadPart('metadata-failure-upload')
    await fs.promises.writeFile(part, 'stl')
    const failure = vi.spyOn(repository, 'completeUploadOperation').mockImplementationOnce(() => {
      throw new Error('database full')
    })
    repository.createUploadSession('metadata-failure-upload', admin.id, Date.now() + 60_000, 3)
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
    expect(repository.listOperations()).toHaveLength(1)
    expect(await fs.promises.readdir(assets.absolute('todo'))).toHaveLength(1)
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
    expect(repository.listRequests()).toHaveLength(1)
    expect(repository.listOperations()).toHaveLength(0)
  })

  it('durably rejects concurrent move and delete operations for one request', async () => {
    const id = await request()
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const original = assets.ensureMoved.bind(assets)
    vi.spyOn(assets, 'ensureMoved').mockImplementationOnce(async (...args) => {
      await blocked
      return original(...args)
    })
    const moving = service.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1 }, admin)
    await vi.waitFor(() => expect(repository.listOperations()).toHaveLength(1))
    await expect(service.moveCopies({ id, from: 'todo', to: 'done', count: 1 }, admin)).rejects.toMatchObject({ status: 409 })
    await expect(service.remove(id, admin)).rejects.toMatchObject({ status: 409 })
    expect(() => service.update(id, { quantity: 2 }, admin)).toThrow(expect.objectContaining({ status: 409 }))
    release()
    await moving
    expect(repository.getRequest(id)).toMatchObject({ counts: { todo: 0, in_progress: 1 }, filePath: 'in-progress/model.stl' })
    expect(repository.listOperations()).toHaveLength(0)
  })

  it('recovers when the original finalize fails transiently', async () => {
    const uploadId = 'original-finalize-retry'
    const part = staging.uploadPart(uploadId)
    await fs.promises.writeFile(part, 'stl')
    repository.createUploadSession(uploadId, admin.id, Date.now() + 60_000, 3)
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
    expect(repository.listOperations()).toHaveLength(1)
    vi.restoreAllMocks()
    await service.recoverOperations()
    expect(repository.listRequests()[0]).toMatchObject({ name: 'Model' })
    expect(repository.listOperations()).toHaveLength(0)
  })

  it('contains rejected optional telemetry promises', async () => {
    const rejecting: Telemetry = {
      capture: async () => {
        throw new Error('telemetry down')
      },
      exception: async () => undefined,
    }
    service = new PrintHubService(repository, assets, staging, new LocalEventBus(), rejecting, { remove: removeTusUpload })
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
    repository.beginOperation(crypto.randomUUID(), {
      kind: 'move',
      requestId: id,
      fromStatus: 'todo',
      toStatus: 'done',
      count: 1,
      sourcePath: 'todo/model.stl',
      destinationPath: 'done/model.stl',
    })
    await assets.ensureMoved('todo/model.stl', 'done/model.stl')
    repository.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1, filePath: 'todo/model.stl' })
    await service.recoverOperations()
    expect(repository.listOperations()).toHaveLength(0)
    expect(await fs.promises.readFile(assets.absolute('todo/model.stl'), 'utf8')).toBe('stl')
    await service.recoverOperations()
  })

  it('returns the original request for an ambiguous final-upload retry', async () => {
    const uploadId = 'ambiguous-upload-id'
    const part = staging.uploadPart(uploadId)
    await fs.promises.writeFile(part, 'stl')
    repository.createUploadSession(uploadId, admin.id, Date.now() + 60_000, 3)
    const input = { name: 'Model', fileName: 'model.stl', quantity: 1 }
    const first = await service.createUploadedRequest(uploadId, part, input, admin)
    const second = await service.createUploadedRequest(uploadId, part, input, admin)
    expect(second).toBe(first)
    expect(repository.listRequests()).toHaveLength(1)
  })

  it('cleans an upload journal whose staged files disappeared before startup replay', async () => {
    const uploadId = 'missing-staged-upload'
    repository.createUploadSession(uploadId, admin.id, Date.now() + 60_000, 3)
    repository.beginUploadOperation(crypto.randomUUID(), {
      kind: 'upload',
      uploadId,
      ownerId: admin.id,
      requestId: crypto.randomUUID(),
      partPath: staging.uploadPart(uploadId),
      destinationPath: 'todo/missing.stl',
      request: { name: 'Missing', fileName: 'missing.stl', quantity: 1, ownerUserId: admin.id },
    })
    await service.recoverOperations()
    expect(repository.listOperations()).toHaveLength(0)
    expect(repository.listRequests()).toHaveLength(0)
  })
})
