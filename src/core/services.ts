import { printGroupColors } from './types'
import type {
  AppEvent,
  AssetStore,
  DeleteOperation,
  EventBus,
  Identity,
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
    private assertAssetsMutable: () => Promise<void> = async () => undefined,
  ) {}

  async listRequests(identity: Identity, privateRequests = false, filters: RequestFilters = {}): Promise<PublicRequestQueryResult> {
    const admin = identity.role === 'admin'
    const result = await this.repository.queryRequests({
      filters,
      visibleToUserId: !admin && privateRequests ? identity.id : undefined,
      searchPrivateMetadata: admin,
    })
    const profiles = await storedPrinterProfiles(this.repository)
    const printers = new Map(profiles.map(({ id, name, printType }) => [id, { id, name, printType }] as const))
    const visibleRequestIds = new Set(result.requests.map((request) => request.id))
    const groups = (await this.repository.listGroups())
      .map((group) => ({ ...group, items: group.items.filter((item) => visibleRequestIds.has(item.requestId)) }))
      .filter((group) => admin || group.items.length > 0)
    return {
      facets: result.facets,
      groups,
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
            groups: groups.flatMap((group) => {
              const item = group.items.find((candidate) => candidate.requestId === request.id)
              return item ? [{ id: group.id, name: group.name, status: group.status, count: item.count }] : []
            }),
            hasPreview: !!previewPath,
            canEdit: admin || (mine && !started),
            canDelete: admin || (mine && !started),
          }
        },
      ),
    }
  }

  async listPeople() {
    return await this.repository.listPeople()
  }

  async getRequest(id: string) {
    return await this.repository.getRequest(id)
  }

  async createRequest(input: NewRequestInput, identity: Identity) {
    await this.assertAssetsMutable()
    const target = await this.resolveTarget(input.requestedPrintType, input.printerId)
    const id = await this.repository.createRequest({
      ...input,
      ownerUserId: identity.id,
      ...target,
    })
    const printType = target.printerId ? printerPrintType((await this.printer(target.printerId))!) : target.requestedPrintType
    this.changed('request.created')
    this.capture(identity.id, 'request_created', {
      print_type: printType,
      assignment_state: target.printerId ? 'assigned' : 'unassigned',
    })
    return id
  }

  async createUploadedRequest(uploadId: string, partPath: string, input: NewUploadedRequestInput, identity: Identity) {
    await this.assertAssetsMutable()
    const completed = await this.repository.getCompletedUpload(uploadId, identity.id)
    if (completed) return completed
    const target = await this.resolveTarget(input.requestedPrintType, input.printerId)
    const request: Omit<NewPrintRequest, 'filePath' | 'previewPath' | 'thumbnailPath'> = {
      ...input,
      ownerUserId: identity.id,
      ...target,
    }
    const printType = request.printerId ? printerPrintType((await this.printer(request.printerId))!) : request.requestedPrintType
    const requestId = crypto.randomUUID()
    const filePath = this.assets.createPath(requestId, request.fileName)
    const operation: UploadOperation = {
      kind: 'upload',
      uploadId,
      ownerId: identity.id,
      requestId,
      partPath,
      destinationPath: filePath,
      request,
    }
    await this.repository.beginUploadOperation(crypto.randomUUID(), operation)
    const pending = (await this.repository.listOperations()).find(
      (candidate) => candidate.payload.kind === 'upload' && candidate.payload.uploadId === uploadId,
    )
    if (!pending) {
      const result = await this.repository.getCompletedUpload(uploadId, identity.id)
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
    await this.assertAssetsMutable()
    this.requireAdmin(identity)
    statusById(input.from)
    statusById(input.to)
    const request = await this.requiredRequest(input.id)
    const movedAt = Date.now()
    if (
      !(input.from in request.counts) ||
      !(input.to in request.counts) ||
      input.from === input.to ||
      !Number.isInteger(input.count) ||
      input.count < 1 ||
      request.counts[input.from] - (await this.groupedCount(input.id, input.from)) < input.count
    ) {
      throw new Response('invalid move', { status: 409 })
    }
    await this.repository.moveCopies({ ...input, filePath: request.filePath, movedAt })
    this.changed('request.copiesMoved')
    this.capture(identity.id, 'request_copies_moved', {
      print_type: await this.requestPrintType(request),
      copy_count: input.count,
      from_status: input.from,
      to_status: input.to,
    })
  }

  async moveCopiesBatch(inputs: { id: string; from: string; to: string; count: number; order?: number }[], identity: Identity) {
    await this.assertAssetsMutable()
    this.requireAdmin(identity)
    if (inputs.length === 0 || new Set(inputs.map(({ id }) => id)).size !== inputs.length) {
      throw new Response('invalid group move', { status: 400 })
    }

    const movedAt = Date.now()
    const plans = await Promise.all(
      inputs.map(async (input) => {
        statusById(input.from)
        statusById(input.to)
        const request = await this.requiredRequest(input.id)
        if (
          !(input.from in request.counts) ||
          !(input.to in request.counts) ||
          input.from === input.to ||
          !Number.isInteger(input.count) ||
          input.count < 1 ||
          request.counts[input.from] - (await this.groupedCount(input.id, input.from)) < input.count
        ) {
          throw new Response('invalid group move', { status: 409 })
        }
        return { input, request }
      }),
    )
    await this.repository.moveCopiesBatch(plans.map(({ input, request }) => ({ ...input, filePath: request.filePath, movedAt })))

    this.changed('request.copiesMoved')
    for (const { input, request } of plans) {
      this.capture(identity.id, 'request_copies_moved', {
        print_type: await this.requestPrintType(request),
        copy_count: input.count,
        from_status: input.from,
        to_status: input.to,
      })
    }
  }

  async createGroup(input: { name?: string; status: string; items: { requestId: string; count: number }[] }, identity: Identity) {
    this.requireAdmin(identity)
    statusById(input.status)
    const requestedName = input.name?.trim()
    if (
      (requestedName !== undefined && (!requestedName || requestedName.length > 80)) ||
      new Set(input.items.map((item) => item.requestId)).size !== input.items.length
    ) {
      throw new Response('invalid group', { status: 400 })
    }
    for (const item of input.items) {
      const request = await this.requiredRequest(item.requestId)
      if (
        !Number.isInteger(item.count) ||
        item.count < 1 ||
        (request.counts[input.status] ?? 0) - (await this.groupedCount(item.requestId, input.status)) < item.count
      ) {
        throw new Response('invalid group', { status: 409 })
      }
    }
    const existingGroups = await this.repository.listGroups()
    const existingNames = new Set(existingGroups.map((group) => group.name))
    let sequence = existingGroups.length + 1
    while (existingNames.has(`Group ${sequence}`)) sequence += 1
    const color = printGroupColors.reduce((selected, candidate) => {
      const selectedCount = existingGroups.filter((group) => group.color === selected).length
      const candidateCount = existingGroups.filter((group) => group.color === candidate).length
      return candidateCount < selectedCount ? candidate : selected
    })
    const id = await this.repository.createGroup(requestedName ?? `Group ${sequence}`, input.status, color, input.items)
    this.changed('board.changed')
    this.capture(identity.id, 'print_group_created')
    return id
  }

  async renameGroup(id: string, name: string, identity: Identity) {
    this.requireAdmin(identity)
    const normalized = name.trim()
    if (!normalized || normalized.length > 80) throw new Response('invalid group', { status: 400 })
    if (!(await this.repository.getGroup(id))) throw new Response('group not found', { status: 404 })
    await this.repository.renameGroup(id, normalized)
    this.changed('board.changed')
    this.capture(identity.id, 'print_group_renamed')
  }

  async deleteGroup(id: string, identity: Identity) {
    this.requireAdmin(identity)
    if (!(await this.repository.getGroup(id))) throw new Response('group not found', { status: 404 })
    await this.repository.deleteGroup(id)
    this.changed('board.changed')
    this.capture(identity.id, 'print_group_deleted')
  }

  async reorderGroupItem(groupId: string, requestId: string, targetRequestId: string, edge: 'before' | 'after', identity: Identity) {
    this.requireAdmin(identity)
    const group = await this.repository.getGroup(groupId)
    if (!group) throw new Response('group not found', { status: 404 })
    if (
      requestId === targetRequestId ||
      !group.items.some((item) => item.requestId === requestId) ||
      !group.items.some((item) => item.requestId === targetRequestId)
    ) {
      throw new Response('invalid group item reorder', { status: 409 })
    }
    await this.repository.reorderGroupItem(groupId, requestId, targetRequestId, edge)
    this.changed('board.changed')
  }

  async moveGroupItem(
    input: { requestId: string; count: number; status: string; fromGroupId?: string; toGroupId?: string; toStatus?: string },
    identity: Identity,
  ) {
    this.requireAdmin(identity)
    statusById(input.status)
    if (input.toStatus) statusById(input.toStatus)
    if (
      (!input.fromGroupId && !input.toGroupId) ||
      input.fromGroupId === input.toGroupId ||
      (input.toStatus !== undefined && input.toStatus === input.status) ||
      !Number.isInteger(input.count) ||
      input.count < 1
    ) {
      throw new Response('invalid group item move', { status: 400 })
    }
    const request = await this.requiredRequest(input.requestId)
    if (
      !input.fromGroupId &&
      (request.counts[input.status] ?? 0) - (await this.groupedCount(input.requestId, input.status)) < input.count
    ) {
      throw new Response('invalid group item move', { status: 409 })
    }
    if (input.toStatus) {
      await this.assertAssetsMutable()
      await this.repository.moveGroupItemAcrossStatus(
        input.requestId,
        input.count,
        input.status,
        input.toStatus,
        input.fromGroupId,
        input.toGroupId,
        request.filePath,
        Date.now(),
      )
      this.changed('request.copiesMoved')
      this.capture(identity.id, 'request_copies_moved', {
        print_type: await this.requestPrintType(request),
        copy_count: input.count,
        from_status: input.status,
        to_status: input.toStatus,
      })
      this.capture(identity.id, 'print_group_item_changed', {
        action: groupItemAction(input.fromGroupId, input.toGroupId),
        copy_count: input.count,
      })
      return
    }
    await this.repository.moveGroupItem(input.requestId, input.count, input.status, input.fromGroupId, input.toGroupId)
    this.changed('board.changed')
    this.capture(identity.id, 'print_group_item_changed', {
      action: groupItemAction(input.fromGroupId, input.toGroupId),
      copy_count: input.count,
    })
  }

  async moveGroup(id: string, to: string, identity: Identity) {
    await this.assertAssetsMutable()
    this.requireAdmin(identity)
    statusById(to)
    const group = await this.repository.getGroup(id)
    if (!group) throw new Response('group not found', { status: 404 })
    statusById(group.status)
    if (group.status === to) throw new Response('invalid group move', { status: 409 })
    const movedAt = Date.now()
    const plans = await Promise.all(
      group.items.map(async (item) => {
        const request = await this.requiredRequest(item.requestId)
        if ((request.counts[group.status] ?? 0) < item.count) throw new Response('invalid group move', { status: 409 })
        return { request, input: { id: item.requestId, from: group.status, to, count: item.count } }
      }),
    )
    await this.repository.moveGroup(
      id,
      to,
      plans.map(({ input, request }) => ({ ...input, filePath: request.filePath, movedAt })),
    )
    this.changed('request.copiesMoved')
    this.capture(identity.id, 'print_group_moved', {
      from_status: group.status,
      to_status: to,
      item_count: group.items.length,
    })
  }

  private async groupedCount(requestId: string, status: string) {
    return (await this.repository.listGroups())
      .filter((group) => group.status === status)
      .flatMap((group) => group.items)
      .filter((item) => item.requestId === requestId)
      .reduce((sum, item) => sum + item.count, 0)
  }

  async reorder(id: string, status: string, order: number, identity: Identity) {
    statusById(status)
    if (status !== initialStatus().id) throw new Response('invalid status', { status: 400 })
    if (!Number.isFinite(order)) throw new Error('invalid order')
    const request = await this.requiredRequest(id)
    if (request.ownerUserId !== identity.id) throw new Response('forbidden', { status: 403 })
    await this.repository.reorderRequest(id, order)
    this.changed('request.reordered')
    this.capture(identity.id, 'request_reordered', { status })
  }

  async update(
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
    const request = await this.requiredRequest(id)
    if (identity.role !== 'admin' && fields.printerId !== undefined) {
      throw new Response('forbidden', { status: 403 })
    }
    const previousPrintType = await this.requestPrintType(request)
    let printerId = request.printerId
    let requestedPrintType = request.requestedPrintType
    let automaticPrinterAssignment: boolean | undefined
    const targetChanged = fields.printerId !== undefined || fields.requestedPrintType !== undefined
    if (targetChanged) {
      const target = await this.resolveTarget(fields.requestedPrintType, fields.printerId, request.id, request.modelDimensions)
      printerId = target.printerId
      requestedPrintType = target.requestedPrintType
      fields.printerId = printerId ?? null
      fields.requestedPrintType = requestedPrintType ?? null
      automaticPrinterAssignment = target.automaticPrinterAssignment
    }
    const printType = printerId ? printerPrintType((await this.printer(printerId))!) : requestedPrintType
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
    await this.repository.updateRequest(id, {
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
    await this.assertAssetsMutable()
    const request = await this.repository.getRequest(id)
    if (!request) return
    if (identity.role !== 'admin') {
      // Requesters may withdraw their own request until a copy starts.
      const started = workflow.statuses.slice(1).some((status) => request.counts[status.id] > 0)
      if (request.ownerUserId !== identity.id || started) throw new Response('forbidden', { status: 403 })
    }
    await this.removeRequest(request)
    this.changed('request.deleted')
    this.capture(identity.id, 'request_deleted', { print_type: await this.requestPrintType(request) })
  }

  async removeCopiesBatch(inputs: { id: string; status: string; count: number }[], identity: Identity) {
    await this.assertAssetsMutable()
    this.requireAdmin(identity)
    if (inputs.length === 0 || new Set(inputs.map(({ id }) => id)).size !== inputs.length) {
      throw new Response('invalid group delete', { status: 400 })
    }
    const plans = await Promise.all(
      inputs.map(async (input) => {
        statusById(input.status)
        const request = await this.requiredRequest(input.id)
        if (!Number.isInteger(input.count) || input.count < 1 || request.counts[input.status] < input.count) {
          throw new Response('invalid group delete', { status: 409 })
        }
        return { ...input, request, deleteRequest: input.count === request.quantity }
      }),
    )
    const removedRequests = plans.filter(({ deleteRequest }) => deleteRequest)
    const groupId = crypto.randomUUID()
    const assets = removedRequests.flatMap(({ request }) =>
      [request.filePath, request.previewPath, request.thumbnailPath]
        .filter((value): value is string => !!value)
        .map((originalPath) => ({ originalPath, trashPath: this.assets.trashPath(groupId, originalPath) })),
    )
    const trashed: typeof assets = []
    try {
      for (const asset of assets) {
        await this.assets.ensureMoved(asset.originalPath, asset.trashPath)
        trashed.push(asset)
      }
      await this.repository.deleteCopiesBatch(plans.map(({ id, status, count, deleteRequest }) => ({ id, status, count, deleteRequest })))
    } catch (error) {
      for (let index = trashed.length - 1; index >= 0; index--) {
        const asset = trashed[index]
        await this.assets.ensureMoved(asset.trashPath, asset.originalPath)
      }
      throw error
    }
    await Promise.allSettled(assets.map((asset) => this.assets.purgeTrash(asset.trashPath)))
    this.changed('request.copiesDeleted')
    for (const { request, count, status, deleteRequest } of plans) {
      this.capture(identity.id, deleteRequest ? 'request_deleted' : 'request_copies_deleted', {
        print_type: await this.requestPrintType(request),
        copy_count: count,
        from_status: status,
      })
    }
  }

  async removeOwnedRequests(userId: string) {
    await this.assertAssetsMutable()
    const operations = await Promise.all(
      (await this.repository.listOperations()).map(async (operation) => {
        if (operation.payload.kind === 'upload') return { operation, owned: operation.payload.ownerId === userId }
        const requestOwnerId = (await this.repository.getRequest(operation.payload.requestId))?.ownerUserId
        const owned =
          operation.payload.kind === 'delete'
            ? operation.payload.ownerUserId === userId || requestOwnerId === userId
            : requestOwnerId === userId
        return { operation, owned }
      }),
    )
    const pending = operations.filter(({ owned }) => owned).map(({ operation }) => operation)
    for (const operation of pending) {
      await this.resumeOperation(operation)
      if ((await this.repository.listOperations()).some(({ id }) => id === operation.id)) throw new Error('storage cleanup is incomplete')
    }
    const requests = (await this.repository.queryRequests({ ownerUserId: userId })).requests
    for (const request of requests) await this.removeRequest(request, true)
    const uploadIds = await this.repository.uploadIdsOwnedBy(userId)
    for (const uploadId of uploadIds) {
      await this.uploads.remove(uploadId)
      await this.staging.remove(this.staging.uploadPart(uploadId))
    }
    await this.repository.deleteUploadSessions(userId)
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
    try {
      await this.repository.beginOperation(operationId, operation)
      await this.resumeOperation({ id: operationId, state: 'prepared', payload: operation })
    } catch (error) {
      const pendingDelete =
        error instanceof Response && error.status === 409
          ? (await this.repository.listOperations()).find(
              (candidate) => candidate.payload.kind === 'delete' && candidate.payload.requestId === request.id,
            )
          : undefined
      if (!pendingDelete) throw error
      await this.resumeOperation(pendingDelete)
    }
  }

  async recoverOperations() {
    for (const operation of await this.repository.listOperations()) await this.resumeOperation(operation)
  }

  private async resumeOperation(operation: PendingOperation) {
    if (operation.payload.kind === 'move') {
      const request = await this.repository.getRequest(operation.payload.requestId)
      if (!request) {
        await this.repository.abandonOperation(operation.id)
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
        await this.repository.abandonOperation(operation.id)
        return
      }
      if (operation.state === 'prepared') {
        await this.assets.ensureMoved(operation.payload.sourcePath, operation.payload.destinationPath)
        await this.repository.markOperationAssetsMoved(operation.id)
      }
      if (operation.state !== 'committed') {
        await this.repository.completeMoveOperation(operation.id, {
          id: operation.payload.requestId,
          from: operation.payload.fromStatus,
          to: operation.payload.toStatus,
          count: operation.payload.count,
          order: operation.payload.order,
          movedAt: operation.payload.movedAt,
          filePath: operation.payload.destinationPath,
        })
      }
      await this.repository.finishOperation(operation.id)
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
          await this.repository.abandonOperation(operation.id)
          return
        }
        await this.repository.markOperationAssetsMoved(operation.id)
      }
      const id = await this.repository.completeUploadOperation(operation.id, operation.payload)
      await this.repository.finishOperation(operation.id)
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
      await this.repository.markOperationAssetsMoved(operation.id)
    }
    if (operation.payload.purgeBeforeDelete && operation.state !== 'committed') {
      await Promise.all(operation.payload.assets.map((asset) => this.assets.purgeTrash(asset.trashPath)))
      await this.repository.completeDeleteOperation(operation.id, operation.payload.requestId)
      await this.repository.finishOperation(operation.id)
      return
    }
    if (operation.state !== 'committed') await this.repository.completeDeleteOperation(operation.id, operation.payload.requestId)
    const purged = await Promise.allSettled(operation.payload.assets.map((asset) => this.assets.purgeTrash(asset.trashPath)))
    if (purged.every((result) => result.status === 'fulfilled')) await this.repository.finishOperation(operation.id)
  }

  private async requiredRequest(id: string) {
    const request = await this.repository.getRequest(id)
    if (!request) throw new Response('not found', { status: 404 })
    return request
  }

  private requireAdmin(identity: Identity) {
    if (identity.role !== 'admin') throw new Response('forbidden', { status: 403 })
  }

  private async printer(id: string) {
    return (await storedPrinterProfiles(this.repository)).find((printer) => printer.id === id)
  }

  private async resolveTarget(
    requestedPrintType?: PrintType | null,
    printerId?: string | null,
    excludeRequestId?: string,
    modelDimensions?: import('./types').ModelDimensions,
  ) {
    await this.validateTarget(requestedPrintType, printerId)
    if (printerId || !requestedPrintType) {
      return { requestedPrintType: undefined, printerId: printerId ?? undefined, automaticPrinterAssignment: false }
    }
    const profiles = await storedPrinterProfiles(this.repository)
    const automatic = automaticallyAssignedPrinter(
      profiles,
      await this.repository.listRequests(),
      requestedPrintType,
      excludeRequestId,
      modelDimensions,
    )
    return automatic
      ? { requestedPrintType: undefined, printerId: automatic.id, automaticPrinterAssignment: true }
      : { requestedPrintType, printerId: undefined, automaticPrinterAssignment: true }
  }

  private async validateTarget(requestedPrintType?: PrintType | null, printerId?: string | null) {
    if (requestedPrintType && printerId) throw new Response('choose a printer or print type, not both', { status: 400 })
    if (!printerId) return
    const printer = await this.printer(printerId)
    if (!printer) throw new Response('unknown printer', { status: 400 })
  }

  private async requestPrintType(request: { requestedPrintType?: PrintType; printerId?: string }) {
    const printer = request.printerId ? await this.printer(request.printerId) : undefined
    return printer ? printerPrintType(printer) : request.requestedPrintType
  }

  private changed(event: AppEvent) {
    this.events.publish(event)
  }

  private capture(identity: string, event: string, properties?: Record<string, unknown>) {
    void this.telemetry.capture(identity, event, properties).catch(() => undefined)
  }
}

function groupItemAction(fromGroupId?: string, toGroupId?: string) {
  if (fromGroupId && toGroupId) return 'transferred'
  return toGroupId ? 'added' : 'removed'
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
