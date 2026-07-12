import type { AssetStore, DeleteOperation, EventBus, Identity, MoveOperation, NewPrintRequest, PendingOperation, Repository, Telemetry, UploadOperation, UploadStagingArea } from './types'
import { thumbnailKey } from './assetKeys'
import { initialStatus, statusById, workflow } from './workflow'

export class PrintHubService {
  constructor(
    private repository: Repository,
    private assets: AssetStore,
    private staging: UploadStagingArea,
    private events: EventBus,
    private telemetry: Telemetry,
  ) {}

  listRequests(identity: Identity, privateRequests = false) {
    const operator = identity.role === 'operator'
    return this.repository.listRequests()
      .filter((request) => operator || !privateRequests || request.requesterEmail === identity.email)
      .map(({ fileName: _fileName, filePath: _filePath, requesterEmail, thumbnailPath: _thumbnailPath, previewPath, ...request }) => {
        const mine = requesterEmail === identity.email
        const started = workflow.statuses.slice(1).some((status) => request.counts[status.id] > 0)
        return {
          ...request,
          mine,
          hasPreview: !!previewPath,
          canEdit: operator || (mine && !started),
          canDelete: operator || (mine && !started),
        }
      })
  }

  listPeople() {
    return this.repository.listPeople()
  }

  getRequest(id: string) {
    return this.repository.getRequest(id)
  }

  createRequest(input: Parameters<Repository['createRequest']>[0], identity: Identity) {
    const id = this.repository.createRequest(input)
    this.changed('request.created')
    this.capture(identity.id, 'request_created', { request_id: id, quantity: input.quantity })
    return id
  }

  async createUploadedRequest(
    uploadId: string,
    partPath: string,
    input: Omit<NewPrintRequest, 'filePath' | 'previewPath' | 'thumbnailPath'>,
    identity: Identity,
    preview?: Uint8Array,
    thumbnail?: { bytes: Uint8Array; mime: string },
  ) {
    const completed = this.repository.getCompletedUpload(uploadId, identity.id)
    if (completed) return completed
    const filePath = this.assets.createPath(input.fileName)
    const previewPath = preview ? this.assets.previewPath(filePath) : undefined
    const previewPartPath = preview ? this.staging.uploadPreviewPart(uploadId) : undefined
    const thumbnailPath = thumbnail ? thumbnailKey(filePath, thumbnail.mime) : undefined
    const thumbnailPartPath = thumbnail ? this.staging.uploadThumbnailPart(uploadId) : undefined
    const operation: UploadOperation = {
      kind: 'upload', uploadId, ownerId: identity.id, requestId: crypto.randomUUID(), partPath,
      destinationPath: filePath, previewPartPath, previewDestinationPath: previewPath,
      thumbnailPartPath, thumbnailDestinationPath: thumbnailPath, request: input,
    }
    try {
      if (preview && previewPartPath) await this.staging.writeUploadPart(previewPartPath, preview)
      if (thumbnail && thumbnailPartPath) await this.staging.writeUploadPart(thumbnailPartPath, thumbnail.bytes)
      this.repository.beginUploadOperation(crypto.randomUUID(), operation)
    } catch (error) {
      if (previewPartPath) await this.staging.remove(previewPartPath)
      if (thumbnailPartPath) await this.staging.remove(thumbnailPartPath)
      throw error
    }
    const pending = this.repository.listOperations().find((candidate) => candidate.payload.kind === 'upload' && candidate.payload.uploadId === uploadId)
    if (!pending) {
      const result = this.repository.getCompletedUpload(uploadId, identity.id)
      if (result) return result
      throw new Error('upload operation was not created')
    }
    const id = await this.resumeOperation(pending)
    this.changed('request.created')
    this.capture(identity.id, 'request_created', { request_id: id, quantity: input.quantity })
    return id!
  }

  async moveCopies(input: { id: string; from: string; to: string; count: number; order?: number }, identity: Identity) {
    this.requireOperator(identity)
    statusById(input.from)
    statusById(input.to)
    const request = this.requiredRequest(input.id)
    if (!(input.from in request.counts) || !(input.to in request.counts) || input.from === input.to || !Number.isInteger(input.count) || input.count < 1 || request.counts[input.from] < input.count) {
      throw new Response('invalid move', { status: 409 })
    }
    const counts = { ...request.counts, [input.from]: request.counts[input.from] - input.count, [input.to]: request.counts[input.to] + input.count }
    const target = workflow.statuses.find((status) => counts[status.id] > 0)?.id ?? workflow.statuses.at(-1)!.id
    const current = workflow.statuses.find((status) => request.counts[status.id] > 0)?.id ?? initialStatus().id
    const filePath = target === current ? request.filePath : this.assets.destinationPath(request.filePath, target)
    if (filePath !== request.filePath) {
      const operationId = crypto.randomUUID()
      const operation: MoveOperation = {
        kind: 'move', requestId: input.id, fromStatus: input.from, toStatus: input.to, count: input.count,
        order: input.order, sourcePath: request.filePath, destinationPath: filePath,
      }
      this.repository.beginOperation(operationId, operation)
      await this.resumeOperation({ id: operationId, state: 'prepared', payload: operation })
    } else {
      this.repository.moveCopies({ ...input, filePath })
    }
    this.changed('request.copiesMoved')
    this.capture(identity.id, 'request_copies_moved', input)
  }

  reorder(id: string, status: string, order: number, identity: Identity) {
    statusById(status)
    if (!Number.isFinite(order)) throw new Error('invalid order')
    const request = this.requiredRequest(id)
    // Requesters may rearrange their own cards; only operators touch others'.
    if (identity.role !== 'operator' && request.requesterEmail !== identity.email) throw new Response('forbidden', { status: 403 })
    this.repository.reorderRequest(id, status, order)
    this.changed('request.reordered')
  }

  update(id: string, fields: { name?: string; quantity?: number; requesterName?: string; notes?: string; sourceUrl?: string }, identity: Identity) {
    if (typeof id !== 'string' || id.length > 100 ||
      (fields.name !== undefined && (typeof fields.name !== 'string' || !fields.name.trim() || fields.name.length > 120)) ||
      (fields.requesterName !== undefined && (typeof fields.requesterName !== 'string' || fields.requesterName.length > 60)) ||
      (fields.notes !== undefined && (typeof fields.notes !== 'string' || fields.notes.length > 2000)) ||
      (fields.sourceUrl !== undefined && (typeof fields.sourceUrl !== 'string' || (fields.sourceUrl.trim() !== '' && !validSourceUrl(fields.sourceUrl.trim())))) ||
      (fields.quantity !== undefined && (typeof fields.quantity !== 'number' || !Number.isInteger(fields.quantity) || fields.quantity < 1 || fields.quantity > 50))) {
      throw new Response('invalid update', { status: 400 })
    }
    const request = this.requiredRequest(id)
    if (identity.role !== 'operator') {
      const started = workflow.statuses.slice(1).some((status) => request.counts[status.id] > 0)
      if (request.requesterEmail !== identity.email || started) throw new Response('forbidden', { status: 403 })
      fields = { quantity: fields.quantity, notes: fields.notes, sourceUrl: fields.sourceUrl }
    }
    this.repository.updateRequest(id, {
      ...fields,
      name: fields.name?.trim(),
      requesterName: fields.requesterName?.trim(),
      notes: fields.notes?.trim(),
      sourceUrl: fields.sourceUrl?.trim(),
    })
    this.changed('request.updated')
  }

  async remove(id: string, identity: Identity) {
    const request = this.requiredRequest(id)
    if (identity.role !== 'operator') {
      // Requesters may withdraw their own request until a copy starts.
      const started = workflow.statuses.slice(1).some((status) => request.counts[status.id] > 0)
      if (request.requesterEmail !== identity.email || started) throw new Response('forbidden', { status: 403 })
    }
    const operationId = crypto.randomUUID()
    const operation: DeleteOperation = {
      kind: 'delete',
      requestId: id,
      assets: [request.filePath, request.previewPath, request.thumbnailPath].filter((value): value is string => !!value)
        .map((originalPath) => ({ originalPath, trashPath: this.assets.trashPath(operationId, originalPath) })),
    }
    this.repository.beginOperation(operationId, operation)
    await this.resumeOperation({ id: operationId, state: 'prepared', payload: operation })
    this.changed('request.deleted')
    this.capture(identity.id, 'request_deleted', { request_id: id })
  }

  async recoverOperations() {
    for (const operation of this.repository.listOperations()) await this.resumeOperation(operation)
  }

  private async resumeOperation(operation: PendingOperation) {
    if (operation.payload.kind === 'move') {
      const request = this.repository.getRequest(operation.payload.requestId)
      if (!request) { this.repository.abandonOperation(operation.id); return }
      if (operation.state !== 'committed' && (request.counts[operation.payload.fromStatus] ?? 0) < operation.payload.count) {
        const [sourceExists, destinationExists] = await Promise.all([
          this.assets.exists(operation.payload.sourcePath), this.assets.exists(operation.payload.destinationPath),
        ])
        if (!sourceExists && destinationExists && request.filePath === operation.payload.sourcePath) {
          await this.assets.ensureMoved(operation.payload.destinationPath, operation.payload.sourcePath)
        }
        this.repository.abandonOperation(operation.id)
        return
      }
      if (operation.state === 'prepared') {
        await this.assets.ensureMoved(operation.payload.sourcePath, operation.payload.destinationPath)
        this.repository.markOperationAssetsMoved(operation.id)
      }
      if (operation.state !== 'committed') {
        this.repository.completeMoveOperation(operation.id, {
          id: operation.payload.requestId,
          from: operation.payload.fromStatus,
          to: operation.payload.toStatus,
          count: operation.payload.count,
          order: operation.payload.order,
          filePath: operation.payload.destinationPath,
        })
      }
      this.repository.finishOperation(operation.id)
      return
    }

    if (operation.payload.kind === 'upload') {
      if (operation.state === 'prepared') {
        try {
          if (operation.payload.previewPartPath && operation.payload.previewDestinationPath) {
            await this.assets.finalizeUpload(operation.payload.previewPartPath, operation.payload.previewDestinationPath)
          }
          if (operation.payload.thumbnailPartPath && operation.payload.thumbnailDestinationPath) {
            await this.assets.finalizeUpload(operation.payload.thumbnailPartPath, operation.payload.thumbnailDestinationPath)
          }
          await this.assets.finalizeUpload(operation.payload.partPath, operation.payload.destinationPath)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          await Promise.allSettled([
            this.assets.remove(operation.payload.destinationPath),
            operation.payload.previewDestinationPath ? this.assets.remove(operation.payload.previewDestinationPath) : Promise.resolve(),
            operation.payload.thumbnailDestinationPath ? this.assets.remove(operation.payload.thumbnailDestinationPath) : Promise.resolve(),
          ])
          this.repository.abandonOperation(operation.id)
          return
        }
        this.repository.markOperationAssetsMoved(operation.id)
      }
      const id = this.repository.completeUploadOperation(operation.id, operation.payload)
      this.repository.finishOperation(operation.id)
      return id
    }

    if (operation.state === 'prepared') {
      for (const asset of operation.payload.assets) {
        const [originalExists, trashExists] = await Promise.all([this.assets.exists(asset.originalPath), this.assets.exists(asset.trashPath)])
        if (!originalExists && !trashExists) continue
        await this.assets.ensureMoved(asset.originalPath, asset.trashPath)
      }
      this.repository.markOperationAssetsMoved(operation.id)
    }
    if (operation.state !== 'committed') this.repository.completeDeleteOperation(operation.id, operation.payload.requestId)
    const purged = await Promise.allSettled(operation.payload.assets.map((asset) => this.assets.purgeTrash(asset.trashPath)))
    if (purged.every((result) => result.status === 'fulfilled')) this.repository.finishOperation(operation.id)
  }

  private requiredRequest(id: string) {
    const request = this.repository.getRequest(id)
    if (!request) throw new Response('not found', { status: 404 })
    return request
  }

  private requireOperator(identity: Identity) {
    if (identity.role !== 'operator') throw new Response('forbidden', { status: 403 })
  }

  private changed(event: string) {
    this.events.publish(event)
  }

  private capture(identity: string, event: string, properties?: Record<string, unknown>) {
    void this.telemetry.capture(identity, event, properties).catch(() => undefined)
  }
}

export function validSourceUrl(value: string) {
  if (value.length > 500) return false
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

