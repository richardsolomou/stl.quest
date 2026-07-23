import type {
  AppEvent,
  AssetStore,
  DeleteOperation,
  EventBus,
  Identity,
  MoveOperation,
  NewPrintRequest,
  PendingOperation,
  PrintRequest,
  PrinterProfile,
  PrintType,
  PublicRequestQueryResult,
  Repository,
  RequestFilters,
  Telemetry,
  UploadOperation,
  UploadStore,
  UploadStagingArea,
} from './types'
import { initialStatus, statusById, workflow } from './workflow'
import { automaticallyAssignedPrinter, normalizePrinterProfile, printerFitsModel, storedPrinterProfiles } from './printers'

export type NewRequestInput = Omit<NewPrintRequest, 'ownerUserId'>
export type NewUploadedRequestInput = Omit<NewRequestInput, 'filePath' | 'previewPath' | 'thumbnailPath'>

export class STLQuestService {
  constructor(
    private repository: Repository,
    private assets: AssetStore,
    private staging: UploadStagingArea,
    private events: EventBus,
    private telemetry: Telemetry,
    private uploads: UploadStore,
    private assertAssetsMutable: () => void = () => undefined,
  ) {}

  listRequests(identity: Identity, privateRequests = false, filters: RequestFilters = {}): PublicRequestQueryResult {
    const admin = identity.role === 'admin'
    const result = this.repository.queryRequests({
      filters,
      visibleToUserId: !admin && privateRequests ? identity.id : undefined,
      searchPrivateMetadata: admin,
    })
    const profiles = storedPrinterProfiles(this.repository)
    const printers = new Map(profiles.map(({ id, name, printType }) => [id, { id, name, printType }] as const))
    const visibleRequestIds = new Set(result.requests.map((request) => request.id))
    const batches = this.repository
      .listBatches()
      .map((batch) => ({ ...batch, items: batch.items.filter((item) => visibleRequestIds.has(item.requestId)) }))
      .filter((batch) => batch.items.length > 0)
    return {
      facets: result.facets,
      batches,
      requests: result.requests.map(
        ({
          fileName: _fileName,
          filePath: _filePath,
          ownerUserId,
          ownerEmail: _ownerEmail,
          ownerName,
          thumbnailPath: _thumbnailPath,
          previewPath,
          requestedPrintType,
          automaticPrinterAssignment: _automaticPrinterAssignment,
          modelDimensions,
          ...request
        }) => {
          const mine = ownerUserId === identity.id
          const started = workflow.statuses.slice(1).some((status) => request.counts[status.id] > 0)
          const printer = request.printerId ? printers.get(request.printerId) : undefined
          const printType = printer?.printType ?? requestedPrintType
          const compatiblePrinters = modelDimensions
            ? profiles.filter((profile) => profile.printType === printType && printerFitsModel(profile, modelDimensions))
            : undefined
          const fitState = !printType
            ? undefined
            : !modelDimensions
              ? 'pending'
              : compatiblePrinters?.length === 0
                ? 'none'
                : request.printerId && compatiblePrinters?.some((profile) => profile.id === request.printerId)
                  ? 'selected_printer'
                  : request.printerId
                    ? 'another_compatible_printer'
                    : undefined
          return {
            ...request,
            requesterId: ownerUserId,
            requesterName: ownerName,
            mine,
            printType,
            requestedPrintType,
            printer,
            fitState,
            batches: batches.flatMap((batch) => {
              const item = batch.items.find((candidate) => candidate.requestId === request.id)
              return item ? [{ id: batch.id, name: batch.name, status: batch.status, count: item.count }] : []
            }),
            hasPreview: !!previewPath,
            canEdit: admin || (mine && !started),
            canDelete: admin || (mine && !started),
          }
        },
      ),
    }
  }

  listPeople() {
    return this.repository.listPeople()
  }

  getRequest(id: string) {
    return this.repository.getRequest(id)
  }

  createRequest(input: NewRequestInput, identity: Identity) {
    this.assertAssetsMutable()
    const target = this.resolveTarget(input.requestedPrintType, input.printerId)
    const id = this.repository.createRequest({
      ...input,
      ownerUserId: identity.id,
      ...target,
    })
    const printType = target.printerId ? printerPrintType(this.printer(target.printerId)!) : target.requestedPrintType
    this.changed('request.created')
    this.capture(identity.id, 'request_created', {
      print_type: printType,
      assignment_state: target.printerId ? 'assigned' : 'unassigned',
    })
    return id
  }

  async createUploadedRequest(uploadId: string, partPath: string, input: NewUploadedRequestInput, identity: Identity) {
    this.assertAssetsMutable()
    const completed = this.repository.getCompletedUpload(uploadId, identity.id)
    if (completed) return completed
    const target = this.resolveTarget(input.requestedPrintType, input.printerId)
    const request: Omit<NewPrintRequest, 'filePath' | 'previewPath' | 'thumbnailPath'> = {
      ...input,
      ownerUserId: identity.id,
      ...target,
    }
    const printType = request.printerId ? printerPrintType(this.printer(request.printerId)!) : request.requestedPrintType
    const filePath = this.assets.createPath(request.fileName)
    const operation: UploadOperation = {
      kind: 'upload',
      uploadId,
      ownerId: identity.id,
      requestId: crypto.randomUUID(),
      partPath,
      destinationPath: filePath,
      request,
    }
    this.repository.beginUploadOperation(crypto.randomUUID(), operation)
    const pending = this.repository
      .listOperations()
      .find((candidate) => candidate.payload.kind === 'upload' && candidate.payload.uploadId === uploadId)
    if (!pending) {
      const result = this.repository.getCompletedUpload(uploadId, identity.id)
      if (result) return result
      throw new Error('upload operation was not created')
    }
    const id = await this.resumeOperation(pending)
    this.changed('request.created')
    this.capture(identity.id, 'request_created', {
      print_type: printType,
      assignment_state: target.printerId ? 'assigned' : 'unassigned',
    })
    return id!
  }

  async moveCopies(input: { id: string; from: string; to: string; count: number; order?: number }, identity: Identity) {
    this.assertAssetsMutable()
    this.requireAdmin(identity)
    statusById(input.from)
    statusById(input.to)
    const request = this.requiredRequest(input.id)
    const movedAt = Date.now()
    if (
      !(input.from in request.counts) ||
      !(input.to in request.counts) ||
      input.from === input.to ||
      !Number.isInteger(input.count) ||
      input.count < 1 ||
      request.counts[input.from] - this.batchedCount(input.id, input.from) < input.count
    ) {
      throw new Response('invalid move', { status: 409 })
    }
    const counts = {
      ...request.counts,
      [input.from]: request.counts[input.from] - input.count,
      [input.to]: request.counts[input.to] + input.count,
    }
    const target = workflow.statuses.find((status) => counts[status.id] > 0)?.id ?? workflow.statuses.at(-1)!.id
    const current = workflow.statuses.find((status) => request.counts[status.id] > 0)?.id ?? initialStatus().id
    const filePath = target === current ? request.filePath : this.assets.destinationPath(request.filePath, target)
    if (filePath !== request.filePath) {
      const operationId = crypto.randomUUID()
      const operation: MoveOperation = {
        kind: 'move',
        requestId: input.id,
        fromStatus: input.from,
        toStatus: input.to,
        count: input.count,
        order: input.order,
        movedAt,
        sourcePath: request.filePath,
        destinationPath: filePath,
      }
      this.repository.beginOperation(operationId, operation)
      await this.resumeOperation({ id: operationId, state: 'prepared', payload: operation })
    } else {
      this.repository.moveCopies({ ...input, filePath, movedAt })
    }
    this.changed('request.copiesMoved')
    this.capture(identity.id, 'request_copies_moved', {
      print_type: this.requestPrintType(request),
      copy_count: input.count,
      from_status: input.from,
      to_status: input.to,
    })
  }

  async moveCopiesBatch(inputs: { id: string; from: string; to: string; count: number; order?: number }[], identity: Identity) {
    this.assertAssetsMutable()
    this.requireAdmin(identity)
    if (inputs.length === 0 || new Set(inputs.map(({ id }) => id)).size !== inputs.length) {
      throw new Response('invalid batch move', { status: 400 })
    }

    const movedAt = Date.now()
    const plans = inputs.map((input) => {
      statusById(input.from)
      statusById(input.to)
      const request = this.requiredRequest(input.id)
      if (
        !(input.from in request.counts) ||
        !(input.to in request.counts) ||
        input.from === input.to ||
        !Number.isInteger(input.count) ||
        input.count < 1 ||
        request.counts[input.from] - this.batchedCount(input.id, input.from) < input.count
      ) {
        throw new Response('invalid batch move', { status: 409 })
      }
      const counts = {
        ...request.counts,
        [input.from]: request.counts[input.from] - input.count,
        [input.to]: request.counts[input.to] + input.count,
      }
      const target = workflow.statuses.find((status) => counts[status.id] > 0)?.id ?? workflow.statuses.at(-1)!.id
      const current = workflow.statuses.find((status) => request.counts[status.id] > 0)?.id ?? initialStatus().id
      const filePath = target === current ? request.filePath : this.assets.destinationPath(request.filePath, target)
      return { input, request, sourcePath: request.filePath, filePath }
    })

    const moved: { sourcePath: string; filePath: string }[] = []
    try {
      for (const plan of plans) {
        if (plan.filePath === plan.sourcePath) continue
        await this.assets.ensureMoved(plan.sourcePath, plan.filePath)
        moved.push(plan)
      }
      this.repository.moveCopiesBatch(plans.map(({ input, filePath }) => ({ ...input, filePath, movedAt })))
    } catch (error) {
      for (let index = moved.length - 1; index >= 0; index--) {
        const plan = moved[index]
        await this.assets.ensureMoved(plan.filePath, plan.sourcePath)
      }
      throw error
    }

    this.changed('request.copiesMoved')
    for (const { input, request } of plans) {
      this.capture(identity.id, 'request_copies_moved', {
        print_type: this.requestPrintType(request),
        copy_count: input.count,
        from_status: input.from,
        to_status: input.to,
      })
    }
  }

  createBatch(input: { name: string; status: string; items: { requestId: string; count: number }[] }, identity: Identity) {
    this.requireAdmin(identity)
    statusById(input.status)
    const name = input.name.trim()
    if (
      !name ||
      name.length > 80 ||
      input.items.length === 0 ||
      new Set(input.items.map((item) => item.requestId)).size !== input.items.length
    ) {
      throw new Response('invalid batch', { status: 400 })
    }
    for (const item of input.items) {
      const request = this.requiredRequest(item.requestId)
      if (
        !Number.isInteger(item.count) ||
        item.count < 1 ||
        (request.counts[input.status] ?? 0) - this.batchedCount(item.requestId, input.status) < item.count
      ) {
        throw new Response('invalid batch', { status: 409 })
      }
    }
    const id = this.repository.createBatch(name, input.status, input.items)
    this.changed('board.changed')
    return id
  }

  async moveBatch(id: string, to: string, identity: Identity) {
    this.assertAssetsMutable()
    this.requireAdmin(identity)
    statusById(to)
    const batch = this.repository.getBatch(id)
    if (!batch) throw new Response('batch not found', { status: 404 })
    statusById(batch.status)
    if (batch.status === to) throw new Response('invalid batch move', { status: 409 })
    const movedAt = Date.now()
    const plans = batch.items.map((item) => {
      const request = this.requiredRequest(item.requestId)
      if ((request.counts[batch.status] ?? 0) < item.count) throw new Response('invalid batch move', { status: 409 })
      const counts = {
        ...request.counts,
        [batch.status]: request.counts[batch.status] - item.count,
        [to]: request.counts[to] + item.count,
      }
      const target = workflow.statuses.find((status) => counts[status.id] > 0)?.id ?? workflow.statuses.at(-1)!.id
      const current = workflow.statuses.find((status) => request.counts[status.id] > 0)?.id ?? initialStatus().id
      const filePath = target === current ? request.filePath : this.assets.destinationPath(request.filePath, target)
      return { request, sourcePath: request.filePath, filePath, input: { id: item.requestId, from: batch.status, to, count: item.count } }
    })
    const moved: typeof plans = []
    try {
      for (const plan of plans) {
        if (plan.filePath === plan.sourcePath) continue
        await this.assets.ensureMoved(plan.sourcePath, plan.filePath)
        moved.push(plan)
      }
      this.repository.moveBatch(
        id,
        to,
        plans.map(({ input, filePath }) => ({ ...input, filePath, movedAt })),
      )
    } catch (error) {
      for (let index = moved.length - 1; index >= 0; index--) await this.assets.ensureMoved(moved[index].filePath, moved[index].sourcePath)
      throw error
    }
    this.changed('request.copiesMoved')
  }

  private batchedCount(requestId: string, status: string) {
    return this.repository
      .listBatches()
      .filter((batch) => batch.status === status)
      .flatMap((batch) => batch.items)
      .filter((item) => item.requestId === requestId)
      .reduce((sum, item) => sum + item.count, 0)
  }

  reorder(id: string, status: string, order: number, identity: Identity) {
    statusById(status)
    if (status !== initialStatus().id) throw new Response('invalid status', { status: 400 })
    if (!Number.isFinite(order)) throw new Error('invalid order')
    const request = this.requiredRequest(id)
    if (request.ownerUserId !== identity.id) throw new Response('forbidden', { status: 403 })
    this.repository.reorderRequest(id, order)
    this.changed('request.reordered')
  }

  update(
    id: string,
    fields: {
      name?: string
      quantity?: number
      notes?: string
      sourceUrl?: string
      requestedPrintType?: PrintType | null
      printerId?: string | null
    },
    identity: Identity,
  ) {
    if (
      typeof id !== 'string' ||
      id.length > 100 ||
      (fields.name !== undefined && (typeof fields.name !== 'string' || !fields.name.trim() || fields.name.length > 120)) ||
      (fields.notes !== undefined && (typeof fields.notes !== 'string' || fields.notes.length > 2000)) ||
      (fields.sourceUrl !== undefined &&
        (typeof fields.sourceUrl !== 'string' || (fields.sourceUrl.trim() !== '' && !validSourceUrl(fields.sourceUrl.trim())))) ||
      (fields.requestedPrintType !== undefined &&
        fields.requestedPrintType !== null &&
        fields.requestedPrintType !== 'resin' &&
        fields.requestedPrintType !== 'filament') ||
      (fields.printerId !== undefined &&
        fields.printerId !== null &&
        (typeof fields.printerId !== 'string' || fields.printerId.length > 100)) ||
      (fields.quantity !== undefined &&
        (typeof fields.quantity !== 'number' || !Number.isInteger(fields.quantity) || fields.quantity < 1 || fields.quantity > 50))
    ) {
      throw new Response('invalid update', { status: 400 })
    }
    const request = this.requiredRequest(id)
    if (identity.role !== 'admin' && fields.printerId !== undefined) {
      throw new Response('forbidden', { status: 403 })
    }
    const previousPrintType = this.requestPrintType(request)
    let printerId = request.printerId
    let requestedPrintType = request.requestedPrintType
    let automaticPrinterAssignment: boolean | undefined
    const targetChanged = fields.printerId !== undefined || fields.requestedPrintType !== undefined
    if (targetChanged) {
      const target = this.resolveTarget(fields.requestedPrintType, fields.printerId, request.id, request.modelDimensions)
      printerId = target.printerId
      requestedPrintType = target.requestedPrintType
      fields.printerId = printerId ?? null
      fields.requestedPrintType = requestedPrintType ?? null
      automaticPrinterAssignment = target.automaticPrinterAssignment
    }
    const printType = printerId ? printerPrintType(this.printer(printerId)!) : requestedPrintType
    const printTypeChanged = printType !== previousPrintType
    if (identity.role !== 'admin') {
      const started = workflow.statuses.slice(1).some((status) => request.counts[status.id] > 0)
      if (request.ownerUserId !== identity.id || started) throw new Response('forbidden', { status: 403 })
      fields = {
        name: fields.name,
        quantity: fields.quantity,
        notes: fields.notes,
        sourceUrl: fields.sourceUrl,
        requestedPrintType: fields.requestedPrintType,
        printerId: fields.printerId,
      }
    }
    this.repository.updateRequest(id, {
      ...fields,
      name: fields.name?.trim(),
      notes: fields.notes?.trim(),
      sourceUrl: fields.sourceUrl?.trim(),
      automaticPrinterAssignment,
    })
    this.changed('request.updated')
    return { printTypeChanged }
  }

  async remove(id: string, identity: Identity) {
    this.assertAssetsMutable()
    const request = this.requiredRequest(id)
    if (identity.role !== 'admin') {
      // Requesters may withdraw their own request until a copy starts.
      const started = workflow.statuses.slice(1).some((status) => request.counts[status.id] > 0)
      if (request.ownerUserId !== identity.id || started) throw new Response('forbidden', { status: 403 })
    }
    await this.removeRequest(request)
    this.changed('request.deleted')
    this.capture(identity.id, 'request_deleted', { print_type: this.requestPrintType(request) })
  }

  async removeBatch(ids: string[], identity: Identity) {
    this.assertAssetsMutable()
    this.requireAdmin(identity)
    if (ids.length === 0 || new Set(ids).size !== ids.length) throw new Response('invalid batch delete', { status: 400 })
    const requests = ids.map((id) => this.requiredRequest(id))
    const batchId = crypto.randomUUID()
    const assets = requests.flatMap((request) =>
      [request.filePath, request.previewPath, request.thumbnailPath]
        .filter((value): value is string => !!value)
        .map((originalPath) => ({ originalPath, trashPath: this.assets.trashPath(batchId, originalPath) })),
    )
    const trashed: typeof assets = []
    try {
      for (const asset of assets) {
        await this.assets.ensureMoved(asset.originalPath, asset.trashPath)
        trashed.push(asset)
      }
      this.repository.deleteRequests(ids)
    } catch (error) {
      for (let index = trashed.length - 1; index >= 0; index--) {
        const asset = trashed[index]
        await this.assets.ensureMoved(asset.trashPath, asset.originalPath)
      }
      throw error
    }
    await Promise.allSettled(assets.map((asset) => this.assets.purgeTrash(asset.trashPath)))
    this.changed('request.deleted')
    for (const request of requests) this.capture(identity.id, 'request_deleted', { print_type: this.requestPrintType(request) })
  }

  async removeOwnedRequests(userId: string) {
    this.assertAssetsMutable()
    const pending = this.repository.listOperations().filter((operation) => {
      if (operation.payload.kind === 'upload') return operation.payload.ownerId === userId
      const requestOwnerId = this.repository.getRequest(operation.payload.requestId)?.ownerUserId
      return operation.payload.kind === 'delete'
        ? operation.payload.ownerUserId === userId || requestOwnerId === userId
        : requestOwnerId === userId
    })
    for (const operation of pending) {
      await this.resumeOperation(operation)
      if (this.repository.listOperations().some(({ id }) => id === operation.id)) throw new Error('storage cleanup is incomplete')
    }
    const requests = this.repository.queryRequests({ ownerUserId: userId }).requests
    for (const request of requests) await this.removeRequest(request, true)
    const uploadIds = this.repository.uploadIdsOwnedBy(userId)
    for (const uploadId of uploadIds) {
      await this.uploads.remove(uploadId)
      await this.staging.remove(this.staging.uploadPart(uploadId))
    }
    this.repository.deleteUploadSessions(userId)
    if (requests.length > 0) this.changed('request.deleted')
  }

  private async removeRequest(request: PrintRequest, purgeBeforeDelete = false) {
    const operationId = crypto.randomUUID()
    const operation: DeleteOperation = {
      kind: 'delete',
      requestId: request.id,
      ownerUserId: request.ownerUserId,
      purgeBeforeDelete,
      assets: [request.filePath, request.previewPath, request.thumbnailPath]
        .filter((value): value is string => !!value)
        .map((originalPath) => ({ originalPath, trashPath: this.assets.trashPath(operationId, originalPath) })),
    }
    this.repository.beginOperation(operationId, operation)
    await this.resumeOperation({ id: operationId, state: 'prepared', payload: operation })
  }

  async recoverOperations() {
    for (const operation of this.repository.listOperations()) await this.resumeOperation(operation)
  }

  private async resumeOperation(operation: PendingOperation) {
    if (operation.payload.kind === 'move') {
      const request = this.repository.getRequest(operation.payload.requestId)
      if (!request) {
        this.repository.abandonOperation(operation.id)
        return
      }
      if (operation.state !== 'committed' && (request.counts[operation.payload.fromStatus] ?? 0) < operation.payload.count) {
        const [sourceExists, destinationExists] = await Promise.all([
          this.assets.exists(operation.payload.sourcePath),
          this.assets.exists(operation.payload.destinationPath),
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
          movedAt: operation.payload.movedAt,
          filePath: operation.payload.destinationPath,
        })
      }
      this.repository.finishOperation(operation.id)
      return
    }

    if (operation.payload.kind === 'upload') {
      if (operation.state === 'prepared') {
        try {
          await this.assets.finalizeUpload(operation.payload.partPath, operation.payload.destinationPath)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          // ENOENT normally means a crash-recovery replay whose staged part
          // was already consumed. If the part is still intact, the
          // destination failed — surface it instead of dropping the upload.
          if ((await this.staging.size(operation.payload.partPath)) > 0) throw error
          await this.assets.remove(operation.payload.destinationPath).catch(() => undefined)
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
        const [originalExists, trashExists] = await Promise.all([
          this.assets.exists(asset.originalPath),
          this.assets.exists(asset.trashPath),
        ])
        if (!originalExists && !trashExists) continue
        await this.assets.ensureMoved(asset.originalPath, asset.trashPath)
      }
      this.repository.markOperationAssetsMoved(operation.id)
    }
    if (operation.payload.purgeBeforeDelete && operation.state !== 'committed') {
      await Promise.all(operation.payload.assets.map((asset) => this.assets.purgeTrash(asset.trashPath)))
      this.repository.completeDeleteOperation(operation.id, operation.payload.requestId)
      this.repository.finishOperation(operation.id)
      return
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

  private requireAdmin(identity: Identity) {
    if (identity.role !== 'admin') throw new Response('forbidden', { status: 403 })
  }

  private printer(id: string) {
    return storedPrinterProfiles(this.repository).find((printer) => printer.id === id)
  }

  private resolveTarget(
    requestedPrintType?: PrintType | null,
    printerId?: string | null,
    excludeRequestId?: string,
    modelDimensions?: import('./types').ModelDimensions,
  ) {
    this.validateTarget(requestedPrintType, printerId)
    if (printerId || !requestedPrintType) {
      return { requestedPrintType: undefined, printerId: printerId ?? undefined, automaticPrinterAssignment: false }
    }
    const profiles = storedPrinterProfiles(this.repository)
    const automatic = automaticallyAssignedPrinter(
      profiles,
      this.repository.listRequests(),
      requestedPrintType,
      excludeRequestId,
      modelDimensions,
    )
    return automatic
      ? { requestedPrintType: undefined, printerId: automatic.id, automaticPrinterAssignment: true }
      : { requestedPrintType, printerId: undefined, automaticPrinterAssignment: true }
  }

  private validateTarget(requestedPrintType?: PrintType | null, printerId?: string | null) {
    if (requestedPrintType && printerId) throw new Response('choose a printer or print type, not both', { status: 400 })
    if (!printerId) return
    const printer = this.printer(printerId)
    if (!printer) throw new Response('unknown printer', { status: 400 })
  }

  private requestPrintType(request: { requestedPrintType?: PrintType; printerId?: string }) {
    const printer = request.printerId ? this.printer(request.printerId) : undefined
    return printer ? printerPrintType(printer) : request.requestedPrintType
  }

  private changed(event: AppEvent) {
    this.events.publish(event)
  }

  private capture(identity: string, event: string, properties?: Record<string, unknown>) {
    void this.telemetry.capture(identity, event, properties).catch(() => undefined)
  }
}

function printerPrintType(printer: PrinterProfile): PrintType {
  return normalizePrinterProfile(printer).printType
}

export function validSourceUrl(value: string) {
  if (value.length > 500) return false
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}
