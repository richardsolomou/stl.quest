import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalAssetStore } from '../adapters/filesystem'
import { UploadStaging } from '../adapters/staging'
import { LocalEventBus } from '../adapters/events'
import { SqliteRepository } from '../adapters/sqlite'
import type { Identity, Telemetry } from './types'
import { PrintHubService } from './services'

const telemetry: Telemetry = { capture: async () => undefined, exception: async () => undefined }
const operator: Identity = { id: 'operator', email: 'op@example.com', name: 'Operator', role: 'operator' }

describe('PrintHubService crash recovery', () => {
  let root: string
  let data: string
  let repository: SqliteRepository
  let assets: LocalAssetStore
  let staging: UploadStaging
  let service: PrintHubService

  beforeEach(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-service-'))
    data = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-service-data-'))
    repository = new SqliteRepository(new Database(':memory:'))
    assets = new LocalAssetStore(root)
    staging = new UploadStaging(data)
    await Promise.all([assets.initialize(), staging.initialize()])
    service = new PrintHubService(repository, assets, staging, new LocalEventBus(), telemetry)
  })

  afterEach(async () => {
    repository.close()
    await Promise.all([fs.promises.rm(root, { recursive: true }), fs.promises.rm(data, { recursive: true })])
  })

  async function request() {
    await assets.write('todo/model.stl', new TextEncoder().encode('stl'))
    const id = repository.createRequest({ name: 'Model', fileName: 'model.stl', filePath: 'todo/model.stl', quantity: 1, requesterEmail: 'owner@example.com' })
    return id
  }

  it('finishes a delete after restarting between the filesystem and database phases', async () => {
    const id = await request()
    const failure = vi.spyOn(repository, 'deleteRequest').mockImplementationOnce(() => { throw new Error('database unavailable') })
    await expect(service.remove(id, operator)).rejects.toThrow('database unavailable')
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
      name: 'Previewed', fileName: 'with-preview.stl', filePath: 'todo/with-preview.stl',
      previewPath: '.printhub/previews/with-preview.stl', quantity: 1, requesterEmail: 'owner@example.com',
    })
    const failure = vi.spyOn(repository, 'deleteRequest').mockImplementationOnce(() => { throw new Error('database unavailable') })
    await expect(service.remove(id, operator)).rejects.toThrow('database unavailable')
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
    await expect(service.remove(id, operator)).resolves.toBeUndefined()
    expect(repository.getRequest(id)).toBeUndefined()
    expect(repository.listOperations()).toHaveLength(1)
    await service.recoverOperations()
    expect(repository.listOperations()).toHaveLength(0)
  })

  it('replays a prepared move idempotently after restart', async () => {
    const id = await request()
    const operationId = crypto.randomUUID()
    repository.beginOperation(operationId, {
      kind: 'move', requestId: id, fromStatus: 'todo', toStatus: 'in_progress', count: 1,
      sourcePath: 'todo/model.stl', destinationPath: 'in-progress/model.stl',
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
      kind: 'move', requestId: id, fromStatus: 'todo', toStatus: 'done', count: 1,
      sourcePath: 'todo/model.stl', destinationPath: 'done/model.stl',
    })
    await assets.ensureMoved('todo/model.stl', 'done/model.stl')
    await service.recoverOperations()
    expect(repository.getRequest(id)).toMatchObject({ filePath: 'done/model.stl', counts: { todo: 0, done: 1 } })
  })

  it('replays a pending operation before removing an old workflow status', async () => {
    const id = await request()
    const raw = (repository as unknown as { db: Database.Database }).db
    raw.prepare("UPDATE request_statuses SET quantity=0 WHERE request_id=? AND status_id='todo'").run(id)
    raw.prepare("INSERT INTO request_statuses VALUES (?, 'retired', 1, NULL)").run(id)
    await assets.ensureMoved('todo/model.stl', 'retired/model.stl')
    raw.prepare("UPDATE requests SET file_path='retired/model.stl' WHERE id=?").run(id)
    repository.beginOperation(crypto.randomUUID(), {
      kind: 'move', requestId: id, fromStatus: 'retired', toStatus: 'done', count: 1,
      sourcePath: 'retired/model.stl', destinationPath: 'done/model.stl',
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
    const theirs = repository.createRequest({ name: 'Theirs', fileName: 'other.stl', filePath: 'todo/other.stl', quantity: 1, requesterEmail: 'someone-else@example.com' })
    const requester: Identity = { id: 'requester', email: 'owner@example.com', name: 'Owner', role: 'requester' }

    const shared = service.listRequests(requester, false)
    expect(shared).toHaveLength(2)
    const privately = service.listRequests(requester, true)
    expect(privately).toHaveLength(1)
    expect(privately[0]).toMatchObject({ id: mine, mine: true, canDelete: true })
    expect(service.listRequests(operator, true)).toHaveLength(2)

    service.reorder(mine, 'todo', 3, requester)
    expect(() => service.reorder(theirs, 'todo', 3, requester)).toThrow(expect.objectContaining({ status: 403 }))
    await expect(service.remove(theirs, requester)).rejects.toMatchObject({ status: 403 })
    await service.remove(mine, requester)
    expect(repository.getRequest(mine)).toBeUndefined()
  })

  it('blocks requester deletion once a copy has started', async () => {
    const id = await request()
    const requester: Identity = { id: 'requester', email: 'owner@example.com', name: 'Owner', role: 'requester' }
    await service.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1 }, operator)
    await expect(service.remove(id, requester)).rejects.toMatchObject({ status: 403 })
    expect(service.listRequests(requester, true)[0]).toMatchObject({ canDelete: false })
  })

  it('returns public role-aware requests and enforces requester authorization', async () => {
    const id = await request()
    const requester: Identity = { id: 'requester', email: 'owner@example.com', name: 'Owner', role: 'requester' }
    expect(service.listRequests(requester)[0]).toMatchObject({ id: id, mine: true, canEdit: true, canDelete: true, hasPreview: false })
    expect(service.listRequests(requester)[0]).not.toHaveProperty('filePath')
    expect(service.listRequests(requester)[0]).not.toHaveProperty('requesterEmail')
    await service.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1 }, operator)
    expect(service.listRequests(requester)[0]).toMatchObject({ canEdit: false, canDelete: false })
    expect(() => service.update(id, { notes: 'changed' }, requester)).toThrow()
  })

  it('rejects oversized or malformed updates before persistence', async () => {
    const id = await request()
    expect(() => service.update(id, { name: 'x'.repeat(121) }, operator)).toThrow(expect.objectContaining({ status: 400 }))
    expect(() => service.update(id, { notes: 'x'.repeat(2001) }, operator)).toThrow(expect.objectContaining({ status: 400 }))
    expect(() => service.update(id, { requesterName: 'x'.repeat(61) }, operator)).toThrow(expect.objectContaining({ status: 400 }))
    expect(() => service.update(id, { quantity: 1.5 }, operator)).toThrow(expect.objectContaining({ status: 400 }))
    expect(() => service.update(id, { sourceUrl: 'ftp://example.com/model' }, operator)).toThrow(expect.objectContaining({ status: 400 }))
    expect(() => service.update(id, { sourceUrl: 'not a url' }, operator)).toThrow(expect.objectContaining({ status: 400 }))
    expect(() => service.update(id, { sourceUrl: `https://example.com/${'x'.repeat(500)}` }, operator)).toThrow(expect.objectContaining({ status: 400 }))
    service.update(id, { sourceUrl: 'https://example.com/model' }, operator)
    expect(repository.getRequest(id)?.sourceUrl).toBe('https://example.com/model')
    service.update(id, { sourceUrl: '' }, operator)
    expect(repository.getRequest(id)?.sourceUrl).toBeFalsy()
    expect(repository.getRequest(id)?.name).toBe('Model')
  })

  it('trashes generated thumbnails alongside the original on delete', async () => {
    const id = await request()
    await assets.write('.printhub/thumbnails/model.png', new TextEncoder().encode('png bytes'))
    repository.completeAssetGeneration(id, { thumbnailPath: '.printhub/thumbnails/model.png' })
    expect(repository.getRequest(id)!.hasThumbnail).toBe(true)
    await service.remove(id, operator)
    expect(await assets.exists('.printhub/thumbnails/model.png')).toBe(false)
  })

  it('surfaces an unwritable destination instead of silently dropping the upload', async () => {
    const part = staging.uploadPart('unwritable-destination-upload')
    await fs.promises.writeFile(part, 'stl')
    const enoent = Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
    const failure = vi.spyOn(assets, 'finalizeUpload').mockRejectedValue(enoent)
    repository.createUploadSession('unwritable-destination-upload', operator.id, Date.now() + 60_000, 3)
    await expect(service.createUploadedRequest('unwritable-destination-upload', part, {
      name: 'Model', fileName: 'model.stl', quantity: 1, requesterEmail: 'owner@example.com',
    }, operator)).rejects.toThrow('ENOENT')
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
    const failure = vi.spyOn(repository, 'completeUploadOperation').mockImplementationOnce(() => { throw new Error('database full') })
    repository.createUploadSession('metadata-failure-upload', operator.id, Date.now() + 60_000, 3)
    await expect(service.createUploadedRequest('metadata-failure-upload', part, {
      name: 'Model', fileName: 'model.stl', quantity: 1, requesterEmail: 'owner@example.com',
    }, operator)).rejects.toThrow('database full')
    expect(repository.listOperations()).toHaveLength(1)
    expect(await fs.promises.readdir(assets.absolute('todo'))).toHaveLength(1)
    failure.mockRestore()
    const retried = await service.createUploadedRequest('metadata-failure-upload', part, {
      name: 'Model', fileName: 'model.stl', quantity: 1, requesterEmail: 'owner@example.com',
    }, operator)
    expect(retried).toBeTruthy()
    expect(repository.listRequests()).toHaveLength(1)
    expect(repository.listOperations()).toHaveLength(0)
  })

  it('durably rejects concurrent move and delete operations for one request', async () => {
    const id = await request()
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const original = assets.ensureMoved.bind(assets)
    vi.spyOn(assets, 'ensureMoved').mockImplementationOnce(async (...args) => { await blocked; return original(...args) })
    const moving = service.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1 }, operator)
    await vi.waitFor(() => expect(repository.listOperations()).toHaveLength(1))
    await expect(service.moveCopies({ id, from: 'todo', to: 'done', count: 1 }, operator)).rejects.toMatchObject({ status: 409 })
    await expect(service.remove(id, operator)).rejects.toMatchObject({ status: 409 })
    expect(() => service.update(id, { quantity: 2 }, operator)).toThrow(expect.objectContaining({ status: 409 }))
    release()
    await moving
    expect(repository.getRequest(id)).toMatchObject({ counts: { todo: 0, in_progress: 1 }, filePath: 'in-progress/model.stl' })
    expect(repository.listOperations()).toHaveLength(0)
  })

  it('recovers when the original finalize fails transiently', async () => {
    const uploadId = 'original-finalize-retry'
    const part = staging.uploadPart(uploadId)
    await fs.promises.writeFile(part, 'stl')
    repository.createUploadSession(uploadId, operator.id, Date.now() + 60_000, 3)
    vi.spyOn(assets, 'finalizeUpload').mockRejectedValueOnce(new Error('original filesystem failure'))
    await expect(service.createUploadedRequest(uploadId, part, {
      name: 'Model', fileName: 'model.stl', quantity: 1, requesterEmail: operator.email,
    }, operator)).rejects.toThrow('original filesystem failure')
    expect(repository.listOperations()).toHaveLength(1)
    vi.restoreAllMocks()
    await service.recoverOperations()
    expect(repository.listRequests()[0]).toMatchObject({ name: 'Model' })
    expect(repository.listOperations()).toHaveLength(0)
  })

  it('contains rejected optional telemetry promises', async () => {
    const rejecting: Telemetry = { capture: async () => { throw new Error('telemetry down') }, exception: async () => undefined }
    service = new PrintHubService(repository, assets, staging, new LocalEventBus(), rejecting)
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
      kind: 'move', requestId: id, fromStatus: 'todo', toStatus: 'done', count: 1,
      sourcePath: 'todo/model.stl', destinationPath: 'done/model.stl',
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
    repository.createUploadSession(uploadId, operator.id, Date.now() + 60_000, 3)
    const input = { name: 'Model', fileName: 'model.stl', quantity: 1, requesterEmail: 'owner@example.com' }
    const first = await service.createUploadedRequest(uploadId, part, input, operator)
    const second = await service.createUploadedRequest(uploadId, part, input, operator)
    expect(second).toBe(first)
    expect(repository.listRequests()).toHaveLength(1)
  })

  it('cleans an upload journal whose staged files disappeared before startup replay', async () => {
    const uploadId = 'missing-staged-upload'
    repository.createUploadSession(uploadId, operator.id, Date.now() + 60_000, 3)
    repository.beginUploadOperation(crypto.randomUUID(), {
      kind: 'upload', uploadId, ownerId: operator.id, requestId: crypto.randomUUID(),
      partPath: staging.uploadPart(uploadId), destinationPath: 'todo/missing.stl',
      request: { name: 'Missing', fileName: 'missing.stl', quantity: 1, requesterEmail: operator.email },
    })
    await service.recoverOperations()
    expect(repository.listOperations()).toHaveLength(0)
    expect(repository.listRequests()).toHaveLength(0)
  })
})
