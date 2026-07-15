import type {
  AppEvent,
  AssetStore,
  DeleteOperation,
  EventBus,
  Identity,
  MoveOperation,
  NewPrintRequest,
  PendingOperation,
  PrintType,
  PublicRequestQueryResult,
  Repository,
  RequestFilters,
  Telemetry,
  UploadOperation,
  UploadStagingArea,
} from './types'
import { initialStatus, statusById, workflow } from './workflow'
import {
  analysisFitsPrinter,
  modelAnalysisReady,
  normalizePrinterProfile,
  orientationAnalysisReady,
  type PrinterProfile,
} from './platePlanner'

export class PrintHubService {
  constructor(
    private repository: Repository,
    private assets: AssetStore,
    private staging: UploadStagingArea,
    private events: EventBus,
    private telemetry: Telemetry,
  ) {}

  listRequests(identity: Identity, privateRequests = false, filters: RequestFilters = {}): PublicRequestQueryResult {
    const admin = identity.role === 'admin'
    const result = this.repository.queryRequests({
      filters,
      visibleToEmail: !admin && privateRequests ? identity.email : undefined,
      searchPrivateMetadata: admin,
    })
    const profiles = (this.repository.getSetting<PrinterProfile[]>('plate-planner-profiles') ?? []).map(normalizePrinterProfile)
    const printers = new Map(profiles.map((profile) => [profile.id, printerSummary(profile)] as const))
    const analyses = new Map(this.repository.listPlateModelAnalyses().map((analysis) => [analysis.requestId, analysis] as const))
    return {
      facets: result.facets,
      requests: result.requests.map(
        ({
          fileName: _fileName,
          filePath: _filePath,
          requesterEmail,
          thumbnailPath: _thumbnailPath,
          previewPath,
          requestedPrintType,
          ...request
        }) => {
          const mine = requesterEmail === identity.email
          const started = workflow.statuses.slice(1).some((status) => request.counts[status.id] > 0)
          const printer = request.printerId ? printers.get(request.printerId) : undefined
          const printType = printer?.printType ?? requestedPrintType
          const filamentAssumptions =
            printType === 'filament'
              ? sharedFilamentAssumptions(
                  request.printerId
                    ? profiles.filter((profile) => profile.id === request.printerId)
                    : profiles.filter((profile) => profile.enabled),
                )
              : undefined
          const analysis = analyses.get(request.id)
          const analysisReady =
            printType && modelAnalysisReady(analysis) && (printType === 'filament' || orientationAnalysisReady(analysis))
          const compatiblePrinterIds = analysisReady
            ? profiles
                .filter((profile) => profile.enabled && profile.printType === printType && analysisFitsPrinter(analysis, profile))
                .map((profile) => profile.id)
            : undefined
          const fitState = !printType
            ? undefined
            : !compatiblePrinterIds
              ? 'pending'
              : compatiblePrinterIds.length === 0
                ? 'none'
                : !request.printerId
                  ? undefined
                  : compatiblePrinterIds.includes(request.printerId)
                    ? 'selected_printer'
                    : 'another_compatible_printer'
          return {
            ...request,
            mine,
            printType,
            requestedPrintType,
            printer,
            filamentAssumptions,
            compatiblePrinterIds,
            fitState,
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

  createRequest(input: Parameters<Repository['createRequest']>[0], identity: Identity) {
    this.validateTarget(input.requestedPrintType, input.printerId)
    const id = this.repository.createRequest({ ...input, requestedPrintType: input.printerId ? undefined : input.requestedPrintType })
    const printType = input.printerId ? printerPrintType(this.printer(input.printerId)!) : input.requestedPrintType
    this.changed('request.created')
    this.capture(identity.id, 'request_created', {
      print_type: printType,
      assignment_state: input.printerId ? 'assigned' : 'unassigned',
    })
    return id
  }

  async createUploadedRequest(
    uploadId: string,
    partPath: string,
    input: Omit<NewPrintRequest, 'filePath' | 'previewPath' | 'thumbnailPath'>,
    identity: Identity,
  ) {
    const completed = this.repository.getCompletedUpload(uploadId, identity.id)
    if (completed) return completed
    this.validateTarget(input.requestedPrintType, input.printerId)
    input = { ...input, requestedPrintType: input.printerId ? undefined : input.requestedPrintType }
    const printType = input.printerId ? printerPrintType(this.printer(input.printerId)!) : input.requestedPrintType
    const filePath = this.assets.createPath(input.fileName)
    const operation: UploadOperation = {
      kind: 'upload',
      uploadId,
      ownerId: identity.id,
      requestId: crypto.randomUUID(),
      partPath,
      destinationPath: filePath,
      request: input,
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
      assignment_state: input.printerId ? 'assigned' : 'unassigned',
    })
    return id!
  }

  async moveCopies(input: { id: string; from: string; to: string; count: number; order?: number }, identity: Identity) {
    this.requireAdmin(identity)
    statusById(input.from)
    statusById(input.to)
    const request = this.requiredRequest(input.id)
    if (
      !(input.from in request.counts) ||
      !(input.to in request.counts) ||
      input.from === input.to ||
      !Number.isInteger(input.count) ||
      input.count < 1 ||
      request.counts[input.from] < input.count
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
        sourcePath: request.filePath,
        destinationPath: filePath,
      }
      this.repository.beginOperation(operationId, operation)
      await this.resumeOperation({ id: operationId, state: 'prepared', payload: operation })
    } else {
      this.repository.moveCopies({ ...input, filePath })
    }
    this.changed('request.copiesMoved')
    this.capture(identity.id, 'request_copies_moved', {
      print_type: this.requestPrintType(request),
      copy_count: input.count,
      from_status: input.from,
      to_status: input.to,
    })
  }

  reorder(id: string, status: string, order: number, identity: Identity) {
    statusById(status)
    if (!Number.isFinite(order)) throw new Error('invalid order')
    const request = this.requiredRequest(id)
    // Requesters may rearrange their own cards; only admins touch others'.
    if (identity.role !== 'admin' && request.requesterEmail !== identity.email) throw new Response('forbidden', { status: 403 })
    this.repository.reorderRequest(id, status, order)
    this.changed('request.reordered')
  }

  update(
    id: string,
    fields: {
      name?: string
      quantity?: number
      requesterName?: string
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
      (fields.requesterName !== undefined && (typeof fields.requesterName !== 'string' || fields.requesterName.length > 60)) ||
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
    const previousPrintType = this.requestPrintType(request)
    let printerId = request.printerId
    let requestedPrintType = request.requestedPrintType
    const targetChanged = fields.printerId !== undefined || fields.requestedPrintType !== undefined
    if (targetChanged) {
      printerId = fields.printerId ?? undefined
      requestedPrintType = fields.requestedPrintType ?? undefined
      if (fields.requestedPrintType) printerId = undefined
      if (printerId) requestedPrintType = undefined
      this.validateTarget(requestedPrintType, printerId, request.printerId)
      fields.printerId = printerId ?? null
      fields.requestedPrintType = requestedPrintType ?? null
    }
    const printType = printerId ? printerPrintType(this.printer(printerId)!) : requestedPrintType
    const printTypeChanged = printType !== previousPrintType
    if (identity.role !== 'admin') {
      const started = workflow.statuses.slice(1).some((status) => request.counts[status.id] > 0)
      if (request.requesterEmail !== identity.email || started) throw new Response('forbidden', { status: 403 })
      fields = {
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
      requesterName: fields.requesterName?.trim(),
      notes: fields.notes?.trim(),
      sourceUrl: fields.sourceUrl?.trim(),
    })
    this.changed('request.updated')
    return { printTypeChanged }
  }

  async remove(id: string, identity: Identity) {
    const request = this.requiredRequest(id)
    if (identity.role !== 'admin') {
      // Requesters may withdraw their own request until a copy starts.
      const started = workflow.statuses.slice(1).some((status) => request.counts[status.id] > 0)
      if (request.requesterEmail !== identity.email || started) throw new Response('forbidden', { status: 403 })
    }
    const operationId = crypto.randomUUID()
    const operation: DeleteOperation = {
      kind: 'delete',
      requestId: id,
      assets: [request.filePath, request.previewPath, request.thumbnailPath]
        .filter((value): value is string => !!value)
        .map((originalPath) => ({ originalPath, trashPath: this.assets.trashPath(operationId, originalPath) })),
    }
    this.repository.beginOperation(operationId, operation)
    await this.resumeOperation({ id: operationId, state: 'prepared', payload: operation })
    this.changed('request.deleted')
    this.capture(identity.id, 'request_deleted', { print_type: this.requestPrintType(request) })
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
    return (this.repository.getSetting<PrinterProfile[]>('plate-planner-profiles') ?? []).find((printer) => printer.id === id)
  }

  private validateTarget(requestedPrintType?: PrintType | null, printerId?: string | null, currentPrinterId?: string) {
    if (requestedPrintType && printerId) throw new Response('choose a printer or print type, not both', { status: 400 })
    if (!printerId) return
    const printer = this.printer(printerId)
    if (!printer) throw new Response('unknown printer', { status: 400 })
    if (!normalizePrinterProfile(printer).enabled && printerId !== currentPrinterId)
      throw new Response('printer is disabled', { status: 400 })
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

function printerSummary(printer: PrinterProfile) {
  return printer.printType === 'filament'
    ? {
        id: printer.id,
        name: printer.name,
        printType: printer.printType,
        enabled: printer.enabled,
        filamentDiameterMm: printer.filamentDiameterMm,
        materialDensityGPerCm3: printer.materialDensityGPerCm3,
      }
    : { id: printer.id, name: printer.name, printType: printer.printType, enabled: printer.enabled }
}

function sharedFilamentAssumptions(profiles: PrinterProfile[]) {
  const filamentProfiles = profiles.filter((profile) => profile.printType === 'filament')
  const first = filamentProfiles[0]
  if (!first) return undefined
  if (
    filamentProfiles.some(
      (profile) =>
        profile.filamentDiameterMm !== first.filamentDiameterMm || profile.materialDensityGPerCm3 !== first.materialDensityGPerCm3,
    )
  )
    return undefined
  return {
    filamentDiameterMm: first.filamentDiameterMm,
    materialDensityGPerCm3: first.materialDensityGPerCm3,
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
