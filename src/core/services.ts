import { isPrintType, printGroupColors } from './types'
import type {
  AssignableWorkspaceRole,
  CopyMove,
  AttachOperation,
  AppEvent,
  AssetStore,
  BoardConfig,
  CopyTagEdit,
  DeleteOperation,
  EventBus,
  Identity,
  NewPrintRequest,
  Notifier,
  PendingOperation,
  PrintRequest,
  PrinterProfile,
  PrintType,
  PublicPrintRequest,
  PublicRequestQueryResult,
  Repository,
  RepeatOperation,
  RequestFilters,
  Telemetry,
  UploadOperation,
  UploadStore,
  UploadStagingArea,
} from './types'
import { recordOnboardingTask, type OnboardingTaskId } from './onboarding'
import { initialStatus, isReadyStatus, requestStarted, statusById } from './workflow'
import { readyPrintsByRequester, type NotificationKind, type NotificationPreferences } from './notifications'
import {
  automaticallyAssignedPrinter,
  printerFitsModel,
  printerProfileChanges,
  PRINTERS_SKIPPED_SETTING,
  printerValidationError,
} from './printers'
import { storedWorkspacePrintTypes } from './printTypes'
import { storedUsageTracking } from './usageTracking'
import { backfillSummary, usageBackfill, type UsageBackfillSummary } from './usageBackfill'
import {
  coveringPlateTransaction,
  isMeasured,
  MAX_PLATE_FILAMENTS,
  MAX_PLATE_OBJECTS,
  MAX_PLATE_PRINTS,
  plateUsageDrafts,
  splitPlate,
  supersededByPlate,
  type Plate,
  type PlateItem,
  type PlateMaterialChoice,
  type PlateRecordInput,
} from './plates'
import {
  MAX_REQUEST_NAME_LENGTH,
  MAX_BULK_CARDS,
  MAX_REQUEST_NOTES_LENGTH,
  requestAssetPaths,
  validRequestQuantity,
  validRequestUpdate,
  validSourceUrl,
  type RequestUpdateFields,
} from './request'
import { modelFormat, sourceImageKey } from './assetKeys'
import { imageContentType, MAX_COVER_BYTES } from './coverImage'
import { automaticEstimateFields, requestPrintEstimate, type MaterialEstimateSettings } from './printEstimates'
import { consumablesOfKind, type Consumable } from './consumables'
import type { EquipmentItem } from './equipment'
import { activeItems, INVENTORY_LIMITS, type InventoryItems, type InventoryKind } from './inventory'
import { canDeleteInventoryItem, deletedItemKind } from './inventoryDeletion'
import {
  DEFAULT_PRICE_CALCULATOR_SETTINGS,
  PRICE_CALCULATOR_SETTING,
  TYPICAL_RESIN_DENSITY_GRAMS_PER_ML,
  type PriceCalculatorSettings,
} from './priceCalculator'
import {
  consumed,
  MAX_USAGE_LIST,
  stepUsageDrafts,
  stockLevels,
  usagePrefills,
  type StepUsageInput,
  type StockMovementInput,
  type UsageDraft,
  type UsageEvent,
  type UsageFilters,
} from './usage'
import { printGroupCohortKey, printGroupNameTaken, validPrintGroupName } from './printGroups'
import { autoArchiveDue } from './autoArchive'
import { normalizeBoardConfig, withMemberRequestVisibility } from './visibility'
import { messagesFor, type Messages } from './i18n'

export type NewRequestInput = Omit<NewPrintRequest, 'ownerUserId'> & { fileName: string; filePath: string }
export type NewUploadedRequestInput = Omit<NewPrintRequest, 'ownerUserId' | 'filePath' | 'previewPath' | 'thumbnailPath'> & {
  fileName: string
}
export type NewLinkedRequestInput = Pick<
  NewPrintRequest,
  'name' | 'quantity' | 'notes' | 'sourceUrl' | 'sourceImageUrl' | 'printerId' | 'requestedPrintType' | 'automaticPrinterAssignment'
> & { sourceUrl: string; cover?: Uint8Array }
type CopyMoveInput = Pick<CopyMove, 'id' | 'from' | 'to' | 'count' | 'tagIds' | 'order'>

export class STLQuestService {
  constructor(
    private repository: Repository,
    private assets: AssetStore,
    private staging: UploadStagingArea,
    private events: EventBus,
    private telemetry: Telemetry,
    private uploads: UploadStore,
    private assertAssetsMutable: () => Promise<void> = async () => undefined,
    private notifier?: Notifier,
    /** Messages in the current request's language; English outside a request. */
    private messages: () => Messages = () => messagesFor(),
  ) {}

  private get text() {
    return this.messages().server
  }

  async removeWorkspaceMember(actor: Identity, userId: string) {
    if (!actor.superAdmin && actor.role !== 'admin') throw new Response(this.text.access.forbidden, { status: 403 })
    if (actor.id === userId) throw new Response(this.text.workspace.cannotRemoveSelf, { status: 409 })
    if (!(await this.repository.removeWorkspaceMember(userId))) return
    // Clear overrides so they cannot silently apply if this account rejoins.
    const board = normalizeBoardConfig(await this.repository.getSetting<Partial<BoardConfig>>('board'))
    if (board.memberVisibility[userId]) await this.repository.setSetting('board', withMemberRequestVisibility(board, userId, 'default'))
    this.changed('user.created')
    this.capture(actor.id, 'workspace_member_removed', {})
  }

  async addWorkspaceMember(actor: Identity, userId: string, role: AssignableWorkspaceRole) {
    if (!actor.superAdmin) throw new Response(this.text.access.forbidden, { status: 403 })
    if (!(await this.repository.userExists(userId))) throw new Response(this.text.account.notFound, { status: 404 })
    if (!(await this.repository.addWorkspaceMember(userId, role))) return
    this.changed('user.created')
    this.capture(actor.id, 'workspace_member_added', { role })
  }

  async listRequests(identity: Identity, ownRequestsOnly = false, filters: RequestFilters = {}): Promise<PublicRequestQueryResult> {
    const admin = identity.role === 'admin'
    const result = await this.repository.queryRequests({
      filters,
      visibleToUserId: !admin && ownRequestsOnly ? identity.id : undefined,
      searchPrivateMetadata: admin,
    })
    const profiles = await this.repository.listInventory('printers')
    const printers = new Map(profiles.map(({ id, name, printType }) => [id, { id, name, printType }] as const))
    const allGroups = await this.repository.listGroups()
    const geometryJobs = new Map(
      (await this.repository.listAssetGenerationJobs('geometry')).map((job) => [job.requestId, job.status] as const),
    )
    const estimateSettings = await this.rates()
    const mappedRequests = result.requests.map(
      ({
        fileName: _fileName,
        filePath: _filePath,
        ownerUserId,
        ownerEmail: _ownerEmail,
        ownerName,
        sourceImageUrl: _sourceImageUrl,
        sourceImagePath: _sourceImagePath,
        thumbnailPath: _thumbnailPath,
        previewPath,
        requestedPrintType,
        automaticPrinterAssignment: _automaticPrinterAssignment,
        modelDimensions,
        modelVolumeMm3,
        modelSurfaceAreaMm2,
        charged,
        ...request
      }) => {
        const mine = ownerUserId === identity.id
        const started = requestStarted(request.counts)
        const printer = request.printerId ? printers.get(request.printerId) : undefined
        const printType = printer?.printType ?? requestedPrintType
        const compatiblePrinters = modelDimensions
          ? profiles.filter((profile) => !profile.archived && profile.printType === printType && printerFitsModel(profile, modelDimensions))
          : undefined
        const geometryStatus = geometryJobs.get(request.id)
        const fitState: PublicPrintRequest['fitState'] =
          !_filePath || !printType || (!modelDimensions && geometryStatus === 'failed')
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
          ...(admin && charged && { charged }),
          requesterId: ownerUserId,
          requesterName: ownerName,
          mine,
          printType,
          requestedPrintType,
          printer,
          fitState,
          ...automaticEstimateFields({ modelDimensions, modelVolumeMm3, modelSurfaceAreaMm2 }, printType, estimateSettings),
          estimateGeometryStatus: geometryStatus,
          groups: allGroups.flatMap((group) => {
            return group.items
              .filter((candidate) => candidate.requestId === request.id)
              .map((item) => ({
                id: group.id,
                name: group.name,
                color: group.color,
                parentId: group.parentId,
                status: item.status,
                count: item.count,
              }))
          }),
          hasFile: Boolean(_filePath),
          modelFormat: _fileName ? modelFormat(_fileName) : undefined,
          hasSourceImage: Boolean(_sourceImageUrl || _sourceImagePath),
          hasPreview: !!previewPath,
          canEdit: admin || (mine && !started),
          canDelete: admin || (mine && !started),
          canArchive: admin || (mine && !started),
        }
      },
    )
    const requests = filterAndSortEstimates(mappedRequests, filters)
    const visibleRequestIds = new Set(requests.map((request) => request.id))
    const groups = allGroups
      .map((group) => ({ ...group, items: group.items.filter((item) => visibleRequestIds.has(item.requestId)) }))
      .filter((group) => admin || group.items.length > 0)
    return {
      facets: { ...result.facets, available: requests.length },
      groups,
      requests,
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
    const printType = await this.requestPrintType(target)
    this.changed('request.created')
    this.capture(identity.id, 'request_created', {
      print_type: printType,
      assignment_state: target.printerId ? 'assigned' : 'unassigned',
      model_source: 'file',
    })
    return id
  }

  async createLinkedRequest(input: NewLinkedRequestInput, identity: Identity) {
    const name = input.name.trim()
    const notes = input.notes?.trim()
    const sourceUrl = input.sourceUrl.trim()
    if (
      !name ||
      name.length > MAX_REQUEST_NAME_LENGTH ||
      !validRequestQuantity(input.quantity) ||
      (notes?.length ?? 0) > MAX_REQUEST_NOTES_LENGTH ||
      !validSourceUrl(sourceUrl)
    ) {
      throw new Response(this.text.request.invalidLinkedRequest, { status: 400 })
    }
    if (input.cover) await this.assertCover(input.cover)
    const target = await this.resolveTarget(input.requestedPrintType, input.printerId)
    const id = await this.repository.createRequest({
      name,
      quantity: input.quantity,
      ownerUserId: identity.id,
      notes: notes || undefined,
      sourceUrl,
      sourceImageUrl: input.sourceImageUrl,
      ...target,
    })
    if (input.cover) {
      await this.repository.recordSourceImagePath(id, await this.writeCover(id, input.cover))
      this.capture(identity.id, 'request_cover_added', { replaced: false })
    }
    const printType = await this.requestPrintType(target)
    this.changed('request.created')
    this.capture(identity.id, 'request_created', {
      print_type: printType,
      assignment_state: target.printerId ? 'assigned' : 'unassigned',
      model_source: 'link',
    })
    return id
  }

  /** Puts a person's own picture on a print saved from a link, in place of whatever its source link resolved. */
  async setCover(id: string, bytes: Uint8Array, identity: Identity) {
    const request = await this.requiredRequest(id)
    if (identity.role !== 'admin' && (request.ownerUserId !== identity.id || requestStarted(request.counts))) {
      throw new Response(this.text.access.forbidden, { status: 403 })
    }
    if (request.filePath) throw new Response(this.text.request.coverHasModel, { status: 409 })
    await this.assertCover(bytes)
    const sourceImagePath = await this.writeCover(id, bytes)
    await this.repository.updateRequest(id, { sourceImageUrl: null, sourceImagePath })
    this.changed('request.updated')
    this.capture(identity.id, 'request_cover_added', { replaced: Boolean(request.sourceImageUrl || request.sourceImagePath) })
  }

  private async assertCover(bytes: Uint8Array) {
    if (bytes.byteLength > MAX_COVER_BYTES) {
      throw new Response(this.text.request.coverTooLarge(MAX_COVER_BYTES / 1024 / 1024), { status: 413 })
    }
    if (!imageContentType(bytes)) throw new Response(this.text.request.coverNotImage, { status: 400 })
    await this.assertAssetsMutable()
  }

  // The key is derived from the print alone, so a replacement overwrites the cover in place and never orphans one.
  private async writeCover(requestId: string, bytes: Uint8Array) {
    const key = sourceImageKey(requestId)
    await this.assets.write(key, bytes)
    return key
  }

  async createUploadedRequest(uploadId: string, partPath: string, input: NewUploadedRequestInput, identity: Identity) {
    await this.assertAssetsMutable()
    const completed = await this.repository.getCompletedUpload(uploadId, identity.id)
    if (completed) return completed
    const target = await this.resolveTarget(input.requestedPrintType, input.printerId)
    const request: Omit<NewPrintRequest, 'filePath' | 'previewPath' | 'thumbnailPath'> & { fileName: string } = {
      ...input,
      ownerUserId: identity.id,
      ...target,
    }
    const printType = await this.requestPrintType(request)
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
      model_source: 'file',
    })
    return id!
  }

  /**
   * Puts a model on a request, keeping its queue position and history: the one a saved link was always
   * waiting for, or a newer file in place of the model the request already has.
   */
  async attachModel(uploadId: string, partPath: string, requestId: string, fileName: string, identity: Identity) {
    await this.assertAssetsMutable()
    const completed = await this.repository.getCompletedUpload(uploadId, identity.id)
    if (completed) return completed
    const request = await this.requiredRequest(requestId)
    if (identity.role !== 'admin') {
      const started = requestStarted(request.counts)
      if (request.ownerUserId !== identity.id || started) throw new Response(this.text.access.forbidden, { status: 403 })
    }
    const printType = await this.requestPrintType(request)
    const operationId = crypto.randomUUID()
    const destinationPath = this.assets.createPath(requestId, fileName)
    const operation: AttachOperation = {
      kind: 'attach',
      uploadId,
      ownerId: identity.id,
      requestId,
      partPath,
      destinationPath,
      fileName,
      ...(request.filePath ? { replaced: this.supersededAssets(request, operationId) } : {}),
    }
    await this.repository.beginUploadOperation(operationId, operation)
    const pending = (await this.repository.listOperations()).find(
      (candidate) => candidate.payload.kind === 'attach' && candidate.payload.uploadId === uploadId,
    )
    if (!pending) {
      const result = await this.repository.getCompletedUpload(uploadId, identity.id)
      if (result) return result
      // A request carries at most one uncommitted operation, so a move or delete in flight blocks the attach.
      throw new Response(this.text.request.changeStillFinishing, { status: 409 })
    }
    const id = await this.resumeOperation(pending)
    this.changed('request.updated')
    this.capture(identity.id, 'request_model_attached', { print_type: printType, replaced: Boolean(request.filePath) })
    return id!
  }

  // Everything derived from the outgoing mesh goes, including when the replacement reuses its keys: the
  // store refuses to finalize an upload over a file that is still there. The cover is not derived from the
  // model and survives the swap.
  private supersededAssets(request: PrintRequest, operationId: string) {
    return [request.filePath, request.thumbnailPath, request.previewPath]
      .filter((path): path is string => !!path)
      .map((originalPath) => ({ originalPath, trashPath: this.assets.trashPath(operationId, originalPath) }))
  }

  async repeatRequest(id: string, quantity: number, identity: Identity) {
    if (!validRequestUpdate({ quantity })) throw new Response(this.text.request.invalidQuantity, { status: 400 })
    const source = await this.requiredRequest(id)
    if (identity.role !== 'admin' && source.ownerUserId !== identity.id) throw new Response(this.text.access.forbidden, { status: 403 })
    if (!source.fileName || !source.filePath) {
      const repeatedId = await this.repository.createRequest({
        name: source.name,
        quantity,
        ownerUserId: identity.id,
        notes: source.notes,
        sourceUrl: source.sourceUrl!,
        sourceImageUrl: source.sourceImageUrl,
        printerId: source.printerId,
        requestedPrintType: source.requestedPrintType,
        automaticPrinterAssignment: source.automaticPrinterAssignment,
      })
      // Each print keeps its own cover, so a supplied one would otherwise stay behind with the original.
      const cover = await this.cachedSourceImage(source)
      if (cover) await this.cacheSourceImage(repeatedId, cover)
      this.changed('request.created')
      this.capture(identity.id, 'request_created', {
        print_type: await this.requestPrintType(source),
        assignment_state: source.printerId ? 'assigned' : 'unassigned',
        model_source: 'link',
      })
      return repeatedId
    }
    await this.assertAssetsMutable()
    const newRequestId = crypto.randomUUID()
    const destinationPath = this.assets.createPath(newRequestId, source.fileName)
    const operation: RepeatOperation = {
      kind: 'repeat',
      requestId: source.id,
      newRequestId,
      sourcePath: source.filePath,
      destinationPath,
      request: {
        name: source.name,
        fileName: source.fileName,
        quantity,
        ownerUserId: identity.id,
        notes: source.notes,
        sourceUrl: source.sourceUrl,
        sourceImageUrl: source.sourceImageUrl,
        printerId: source.printerId,
        requestedPrintType: source.requestedPrintType,
        automaticPrinterAssignment: source.automaticPrinterAssignment,
      },
    }
    const operationId = crypto.randomUUID()
    await this.repository.beginOperation(operationId, operation)
    const repeatedId = await this.resumeOperation({ id: operationId, state: 'prepared', payload: operation })
    this.changed('request.created')
    this.capture(identity.id, 'request_created', {
      print_type: await this.requestPrintType(source),
      assignment_state: source.printerId ? 'assigned' : 'unassigned',
      model_source: 'file',
    })
    return repeatedId!
  }

  async moveCopies(input: CopyMoveInput, identity: Identity) {
    this.requireAdmin(identity)
    this.assertUniqueCards([{ id: input.id, status: input.from, tagIds: input.tagIds }], this.text.request.invalidMove)
    const request = await this.planCopyMove(input, this.text.request.invalidMove)
    if (request.filePath) await this.assertAssetsMutable()
    const movedAt = Date.now()
    await this.repository.moveCopies({ ...input, filePath: request.filePath, movedAt })
    await this.completeOnboardingTask(identity.id, 'move')
    this.changed('request.copiesMoved')
    await this.notifyReady([{ request, to: input.to, count: input.count }], identity)
    this.capture(identity.id, 'request_copies_moved', {
      print_type: await this.requestPrintType(request),
      copy_count: input.count,
      from_status: input.from,
      to_status: input.to,
      operation: 'single',
    })
  }

  async moveCopiesBatch(inputs: CopyMoveInput[], identity: Identity) {
    this.requireAdmin(identity)
    this.assertUniqueCards(
      inputs.map(({ id, from, tagIds }) => ({ id, status: from, tagIds })),
      this.text.request.invalidGroupMove,
    )

    const movedAt = Date.now()
    const plans = await Promise.all(
      inputs.map(async (input) => ({ input, request: await this.planCopyMove(input, this.text.request.invalidGroupMove) })),
    )
    if (plans.some(({ request }) => request.filePath)) await this.assertAssetsMutable()
    await this.repository.moveCopiesBatch(plans.map(({ input, request }) => ({ ...input, filePath: request.filePath, movedAt })))
    await this.completeOnboardingTask(identity.id, 'move')

    this.changed('request.copiesMoved')
    await this.notifyReady(
      plans.map(({ input, request }) => ({ request, to: input.to, count: input.count })),
      identity,
    )
    const printTypes = await Promise.all(plans.map(({ request }) => this.requestPrintType(request)))
    for (const { input, request } of plans) {
      this.capture(identity.id, 'request_copies_moved', {
        print_type: await this.requestPrintType(request),
        copy_count: input.count,
        from_status: input.from,
        to_status: input.to,
        operation: 'batch',
      })
    }
    this.capture(identity.id, 'request_batch_moved', {
      request_count: unique(inputs.map(({ id }) => id)).length,
      copy_count: inputs.reduce((sum, input) => sum + input.count, 0),
      from_statuses: unique(inputs.map(({ from }) => from)),
      to_statuses: unique(inputs.map(({ to }) => to)),
      print_types: unique(printTypes),
    })
  }

  async createGroup(
    input: { name?: string; parentId?: string; status: string; items: { requestId: string; count: number }[] },
    identity: Identity,
  ) {
    this.requireAdmin(identity)
    statusById(input.status)
    const requestedName = input.name?.trim()
    if (
      (requestedName !== undefined && !validPrintGroupName(requestedName)) ||
      new Set(input.items.map((item) => item.requestId)).size !== input.items.length
    ) {
      throw new Response(this.text.request.invalidGroup, { status: 400 })
    }
    for (const item of input.items) {
      const request = await this.requiredRequest(item.requestId)
      if (!Number.isInteger(item.count) || item.count < 1 || (request.counts[input.status] ?? 0) < item.count) {
        throw new Response(this.text.request.invalidGroup, { status: 409 })
      }
    }
    const { name, color } = await this.newTag(requestedName)
    const id = await this.repository.createGroup(name, input.status, color, input.items, input.parentId)
    this.changed('board.changed')
    this.capture(identity.id, 'print_group_created', {
      item_count: input.items.length,
      copy_count: input.items.reduce((sum, item) => sum + item.count, 0),
    })
    return id
  }

  private async newTag(requestedName?: string) {
    const existingGroups = await this.repository.listGroups()
    let sequence = existingGroups.length + 1
    while (printGroupNameTaken(existingGroups, `Tag ${sequence}`)) sequence += 1
    const color = printGroupColors.reduce((selected, candidate) => {
      const selectedCount = existingGroups.filter((group) => group.color === selected).length
      const candidateCount = existingGroups.filter((group) => group.color === candidate).length
      return candidateCount < selectedCount ? candidate : selected
    })
    return { name: requestedName ?? `Tag ${sequence}`, color }
  }

  async updateGroup(
    id: string,
    fields: { name?: string; color?: (typeof printGroupColors)[number]; parentId?: string | null },
    identity: Identity,
  ) {
    this.requireAdmin(identity)
    const groups = await this.repository.listGroups()
    const group = groups.find((candidate) => candidate.id === id)
    if (!group) throw new Response(this.text.request.tagNotFound, { status: 404 })
    if (fields.name !== undefined && !validPrintGroupName(fields.name.trim()))
      throw new Response(this.text.request.invalidTag, { status: 400 })
    await this.repository.updateGroup(id, { ...fields, name: fields.name?.trim() })
    this.changed('board.changed')
  }

  /** Returns the id of the tag created by `createTagName`, if any. */
  async updateCopyTags(input: CopyTagEdit, identity: Identity) {
    this.requireAdmin(identity)
    const { addTagIds, removeTagIds, items } = input
    const tagIds = [...addTagIds, ...removeTagIds]
    const createTagName = input.createTagName?.trim()
    if (
      (createTagName === undefined && tagIds.length === 0) ||
      (createTagName !== undefined && !validPrintGroupName(createTagName)) ||
      items.length === 0 ||
      new Set(tagIds).size !== tagIds.length ||
      new Set(items.map((item) => `${item.requestId}:${item.status}`)).size !== items.length
    ) {
      throw new Response(this.text.request.invalidTagAssignment, { status: 400 })
    }
    for (const item of items) {
      statusById(item.status)
      const request = await this.requiredRequest(item.requestId)
      if (!Number.isInteger(item.count) || item.count < 1 || (request.counts[item.status] ?? 0) < item.count) {
        throw new Response(this.text.request.invalidTagAssignment, { status: 409 })
      }
    }
    const createTag = createTagName === undefined ? undefined : await this.newTag(createTagName)
    const createdTagId = await this.repository.updateCopyTags({ addTagIds, removeTagIds, items }, createTag)
    this.changed('board.changed')
    this.capture(identity.id, 'print_copy_tags_updated', {
      item_count: items.length,
      status_count: new Set(items.map((item) => item.status)).size,
      added_tag_count: addTagIds.length + (createdTagId ? 1 : 0),
      removed_tag_count: removeTagIds.length,
      created_tag: createdTagId !== undefined,
    })
    return createdTagId
  }

  async deleteGroup(id: string, identity: Identity) {
    this.requireAdmin(identity)
    const group = await this.repository.getGroup(id)
    if (!group) throw new Response(this.text.request.groupNotFound, { status: 404 })
    await this.repository.deleteGroup(id)
    this.changed('board.changed')
    this.capture(identity.id, 'print_group_deleted', {
      item_count: group.items.length,
      copy_count: group.items.reduce((sum, item) => sum + item.count, 0),
    })
  }

  async reorderGroupItem(
    groupId: string,
    status: string,
    requestId: string,
    targetRequestId: string,
    edge: 'before' | 'after',
    identity: Identity,
  ) {
    this.requireAdmin(identity)
    statusById(status)
    const group = await this.repository.getGroup(groupId)
    if (!group) throw new Response(this.text.request.groupNotFound, { status: 404 })
    if (
      requestId === targetRequestId ||
      !group.items.some((item) => item.status === status && item.requestId === requestId) ||
      !group.items.some((item) => item.status === status && item.requestId === targetRequestId)
    ) {
      throw new Response(this.text.request.invalidGroupItemReorder, { status: 409 })
    }
    await this.repository.reorderGroupItem(groupId, status, requestId, targetRequestId, edge)
    this.changed('board.changed')
  }

  async moveGroup(id: string, from: string, to: string, identity: Identity) {
    this.requireAdmin(identity)
    statusById(from)
    statusById(to)
    const group = await this.repository.getGroup(id)
    if (!group) throw new Response(this.text.request.groupNotFound, { status: 404 })
    if (from === to) throw new Response(this.text.request.invalidGroupMove, { status: 409 })
    const items = group.items.filter((item) => item.status === from)
    if (items.length === 0) throw new Response(this.text.request.invalidGroupMove, { status: 409 })
    const movedAt = Date.now()
    const plans = await Promise.all(
      items.map(async (item) => {
        const request = await this.requiredRequest(item.requestId)
        if ((request.counts[from] ?? 0) < item.count) throw new Response(this.text.request.invalidGroupMove, { status: 409 })
        return { request, input: { id: item.requestId, from, to, count: item.count } }
      }),
    )
    if (plans.some(({ request }) => request.filePath)) await this.assertAssetsMutable()
    await this.repository.moveGroup(
      id,
      from,
      to,
      plans.map(({ input, request }) => ({ ...input, filePath: request.filePath, movedAt })),
    )
    await this.completeOnboardingTask(identity.id, 'move')
    this.changed('request.copiesMoved')
    await this.notifyReady(
      plans.map(({ input, request }) => ({ request, to, count: input.count })),
      identity,
    )
    this.capture(identity.id, 'print_group_moved', {
      from_status: from,
      to_status: to,
      item_count: items.length,
      copy_count: items.reduce((sum, item) => sum + item.count, 0),
    })
  }

  private async groupedCount(requestId: string, status: string) {
    return (await this.repository.listGroups())
      .flatMap((group) => group.items)
      .filter((item) => item.requestId === requestId && item.status === status)
      .reduce((sum, item) => sum + item.count, 0)
  }

  private async planCopyMove(input: CopyMoveInput, error: string) {
    statusById(input.from)
    statusById(input.to)
    const request = await this.requiredRequest(input.id)
    if (
      !(input.from in request.counts) ||
      !(input.to in request.counts) ||
      input.from === input.to ||
      !Number.isInteger(input.count) ||
      input.count < 1
    ) {
      throw new Response(error, { status: 409 })
    }
    const available = request.counts[input.from]
    if (available < input.count) throw new Response(error, { status: 409 })
    return request
  }

  async reorder(id: string, status: string, order: number, identity: Identity) {
    statusById(status)
    if (status !== initialStatus().id) throw new Response(this.text.request.invalidStatus, { status: 400 })
    if (!Number.isFinite(order)) throw new Error('invalid order')
    const request = await this.requiredRequest(id)
    if (request.ownerUserId !== identity.id) throw new Response(this.text.access.forbidden, { status: 403 })
    await this.repository.reorderRequest(id, order)
    this.changed('request.reordered')
    this.capture(identity.id, 'request_reordered', { status })
  }

  async update(id: string, fields: RequestUpdateFields, identity: Identity) {
    if (typeof id !== 'string' || id.length > 100 || !validRequestUpdate(fields)) {
      throw new Response(this.text.request.invalidUpdate, { status: 400 })
    }
    const request = await this.requiredRequest(id)
    if (!request.filePath && fields.sourceUrl !== undefined && !fields.sourceUrl.trim()) {
      throw new Response(this.text.request.sourceUrlRequired, { status: 400 })
    }
    if (identity.role !== 'admin' && fields.printerId !== undefined) {
      throw new Response(this.text.access.forbidden, { status: 403 })
    }
    const previousPrintType = await this.requestPrintType(request)
    let printerId = request.printerId
    let requestedPrintType = request.requestedPrintType
    let automaticPrinterAssignment: boolean | undefined
    const targetChanged = fields.printerId !== undefined || fields.requestedPrintType !== undefined
    if (targetChanged) {
      const target = await this.resolveTarget(
        fields.requestedPrintType,
        fields.printerId,
        request.id,
        request.modelDimensions,
        previousPrintType,
      )
      printerId = target.printerId
      requestedPrintType = target.requestedPrintType
      fields.printerId = printerId ?? null
      fields.requestedPrintType = requestedPrintType ?? null
      automaticPrinterAssignment = target.automaticPrinterAssignment
    }
    const printType = await this.requestPrintType({ printerId, requestedPrintType })
    const printTypeChanged = printType !== previousPrintType
    if (identity.role !== 'admin') {
      const started = requestStarted(request.counts)
      if (request.ownerUserId !== identity.id || started) throw new Response(this.text.access.forbidden, { status: 403 })
      fields = {
        name: fields.name,
        quantity: fields.quantity,
        notes: fields.notes,
        sourceUrl: fields.sourceUrl,
        sourceImageUrl: fields.sourceImageUrl,
        requestedPrintType: fields.requestedPrintType,
        printerId: fields.printerId,
        estimatedMaterialOverride: fields.estimatedMaterialOverride,
        estimatedPrintMinutesOverride: fields.estimatedPrintMinutesOverride,
      }
    }
    await this.repository.updateRequest(id, {
      ...fields,
      name: fields.name?.trim(),
      notes: fields.notes?.trim(),
      sourceUrl: fields.sourceUrl?.trim(),
      sourceImageUrl: fields.sourceImageUrl,
      automaticPrinterAssignment,
    })
    if (fields.sourceImageUrl !== undefined && fields.sourceImageUrl !== request.sourceImageUrl) {
      await this.discardCachedSourceImage(request)
    }
    this.changed('request.updated')
    return { printTypeChanged }
  }

  /** Bytes of the cached cover, or undefined when nothing is stored or storage cannot serve it. */
  async cachedSourceImage(request: PrintRequest) {
    if (!request.sourceImagePath) return undefined
    try {
      const asset = await this.assets.read(request.sourceImagePath)
      return new Uint8Array(await new Response(asset.stream).arrayBuffer())
    } catch {
      return undefined
    }
  }

  /** Best effort: a workspace without working storage keeps serving covers straight from the source. */
  async cacheSourceImage(requestId: string, bytes: Uint8Array) {
    let key: string
    try {
      await this.assertAssetsMutable()
      key = await this.writeCover(requestId, bytes)
    } catch {
      return
    }
    await this.repository.recordSourceImagePath(requestId, key)
  }

  private async discardCachedSourceImage(request: PrintRequest) {
    if (!request.sourceImagePath) return
    await this.repository.recordSourceImagePath(request.id, null)
    await this.assets.remove(request.sourceImagePath).catch(() => {})
  }

  async archiveRequests(ids: string[], identity: Identity) {
    await this.setArchived(ids, true, identity)
  }

  async unarchiveRequests(ids: string[], identity: Identity) {
    await this.setArchived(ids, false, identity)
  }

  private async setArchived(ids: string[], archive: boolean, identity: Identity) {
    const uniqueIds = unique(ids)
    if (uniqueIds.length === 0 || uniqueIds.length > MAX_BULK_CARDS || uniqueIds.some((id) => typeof id !== 'string' || id.length > 100)) {
      throw new Response(this.text.request.invalidArchive, { status: 400 })
    }
    const targets = []
    for (const id of uniqueIds) {
      const request = await this.repository.getRequest(id)
      if (!request) continue
      if (identity.role !== 'admin') {
        if (request.ownerUserId !== identity.id) throw new Response(this.text.access.forbidden, { status: 403 })
        // Like deletion, requesters may not hide a request once a copy starts — active work stays visible to operators.
        const started = archive && requestStarted(request.counts)
        if (started) throw new Response(this.text.access.forbidden, { status: 403 })
      }
      if (archive === (request.archivedAt !== undefined)) continue
      targets.push(request)
    }
    if (targets.length === 0) return
    await this.repository.setRequestsArchived(
      targets.map(({ id }) => id),
      archive ? Date.now() : null,
    )
    this.changed(archive ? 'request.archived' : 'request.unarchived')
    for (const request of targets) {
      this.capture(identity.id, archive ? 'request_archived' : 'request_unarchived', {
        print_type: await this.requestPrintType(request),
        copy_count: request.quantity,
      })
    }
  }

  /** Archives requests that have stayed Ready past the workspace's configured delay; does nothing while it is off. */
  async autoArchiveReadyRequests(now = Date.now()) {
    const days = normalizeBoardConfig(await this.repository.getSetting<Partial<BoardConfig>>('board')).autoArchiveDays
    if (days === undefined) return 0
    const due = (requests: Parameters<typeof autoArchiveDue>[0]) => autoArchiveDue(requests, days, now)
    const candidates = due((await this.repository.queryRequests()).requests)
    const ids = await this.repository.archiveRequestsStillDue(candidates, now, due)
    if (ids.length === 0) return 0
    this.changed('request.archived')
    this.capture('server', 'requests_auto_archived', { request_count: ids.length, auto_archive_days: days })
    return ids.length
  }

  async remove(id: string, identity: Identity) {
    const request = await this.repository.getRequest(id)
    if (!request) return
    if (request.filePath) await this.assertAssetsMutable()
    if (identity.role !== 'admin') {
      // Requesters may withdraw their own request until a copy starts.
      const started = requestStarted(request.counts)
      if (request.ownerUserId !== identity.id || started) throw new Response(this.text.access.forbidden, { status: 403 })
    }
    await this.removeRequest(request)
    this.changed('request.deleted')
    this.capture(identity.id, 'request_deleted', {
      print_type: await this.requestPrintType(request),
      copy_count: request.quantity,
      from_statuses: unique(
        Object.entries(request.counts)
          .filter(([, count]) => count > 0)
          .map(([status]) => status),
      ),
      operation: 'single',
    })
  }

  /** Deletes board cards: each input takes `count` copies carrying exactly `tagIds` (none when omitted) from one print's stage. */
  async removeCopiesBatch(inputs: { id: string; status: string; count: number; tagIds?: string[] }[], identity: Identity) {
    this.requireAdmin(identity)
    this.assertUniqueCards(
      inputs.map(({ id, status, tagIds = [] }) => ({ id, status, tagIds })),
      this.text.request.invalidGroupDelete,
    )
    for (const input of inputs) {
      statusById(input.status)
      if (!Number.isInteger(input.count) || input.count < 1) throw new Response(this.text.request.invalidGroupDelete, { status: 409 })
    }
    const plans = await Promise.all(
      unique(inputs.map(({ id }) => id)).map(async (id) => {
        const request = await this.requiredRequest(id)
        const deletions = inputs.filter((input) => input.id === id)
        const stages = unique(deletions.map(({ status }) => status)).map((status) => ({
          status,
          count: deletions.filter((deletion) => deletion.status === status).reduce((sum, deletion) => sum + deletion.count, 0),
        }))
        if (stages.some(({ status, count }) => request.counts[status] < count))
          throw new Response(this.text.request.invalidGroupDelete, { status: 409 })
        const count = stages.reduce((sum, stage) => sum + stage.count, 0)
        return { request, deletions, stages, count, deleteRequest: count === request.quantity }
      }),
    )
    if (plans.some(({ request }) => request.filePath)) await this.assertAssetsMutable()
    const removedRequests = plans.filter(({ deleteRequest }) => deleteRequest)
    const trashGroupId = crypto.randomUUID()
    const assets = removedRequests.flatMap(({ request }) => this.requestTrashAssets(request, trashGroupId))
    const trashed: typeof assets = []
    try {
      const staged = await Promise.allSettled(
        assets.map(async (asset) => {
          if (await this.nothingToMove(asset.originalPath, asset.trashPath)) return
          await this.assets.ensureMoved(asset.originalPath, asset.trashPath)
          return asset
        }),
      )
      for (const result of staged) {
        if (result.status === 'fulfilled' && result.value) trashed.push(result.value)
      }
      const failure = staged.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failure) throw failure.reason
      await this.repository.deleteCopiesBatch(
        plans.flatMap(({ deletions, deleteRequest }) =>
          deletions.map(({ id, status, count, tagIds }) => ({ id, status, count, tagIds, deleteRequest })),
        ),
      )
    } catch (error) {
      await Promise.all(trashed.map((asset) => this.assets.ensureMoved(asset.trashPath, asset.originalPath)))
      throw error
    }
    void Promise.allSettled(assets.map((asset) => this.assets.purgeTrash(asset.trashPath)))
    this.changed('request.copiesDeleted')
    const printTypes = await Promise.all(plans.map(({ request }) => this.requestPrintType(request)))
    for (const [index, { stages, count, deleteRequest }] of plans.entries()) {
      const print_type = printTypes[index]
      if (deleteRequest) {
        this.capture(identity.id, 'request_deleted', {
          print_type,
          copy_count: count,
          ...(stages.length === 1 ? { from_status: stages[0].status } : { from_statuses: stages.map(({ status }) => status) }),
          operation: 'batch',
        })
        continue
      }
      for (const stage of stages) {
        this.capture(identity.id, 'request_copies_deleted', {
          print_type,
          copy_count: stage.count,
          from_status: stage.status,
          operation: 'batch',
        })
      }
    }
    this.capture(identity.id, 'request_batch_deleted', {
      request_count: plans.length,
      copy_count: inputs.reduce((sum, input) => sum + input.count, 0),
      deleted_request_count: removedRequests.length,
      from_statuses: unique(inputs.map(({ status }) => status)),
      print_types: unique(printTypes),
    })
  }

  async removeOwnedRequests(userId: string) {
    await this.assertAssetsMutable()
    const operations = await Promise.all(
      (await this.repository.listOperations()).map(async (operation) => {
        if (operation.payload.kind === 'upload' || operation.payload.kind === 'attach') {
          return { operation, owned: operation.payload.ownerId === userId }
        }
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
    const requests = (await this.repository.queryRequests({ ownerUserId: userId, includeArchived: true })).requests
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
      assets: this.requestTrashAssets(request, operationId),
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
        if (!(await this.nothingToMove(operation.payload.sourcePath, operation.payload.destinationPath))) {
          await this.assets.ensureMoved(operation.payload.sourcePath, operation.payload.destinationPath)
        }
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
          await this.staging.finalizeUpload(
            operation.payload.uploadId,
            operation.payload.partPath,
            operation.payload.destinationPath,
            this.assets,
          )
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
      await this.completeOnboardingTask(operation.payload.ownerId, 'upload')
      await this.repository.finishOperation(operation.id)
      return id
    }

    if (operation.payload.kind === 'attach') {
      const replaced = operation.payload.replaced ?? []
      if (operation.state === 'prepared') {
        // The superseded model moves out first: a replacement under the same file name lands on its key.
        for (const asset of replaced) {
          if (await this.nothingToMove(asset.originalPath, asset.trashPath)) continue
          await this.assets.ensureMoved(asset.originalPath, asset.trashPath)
        }
        try {
          await this.staging.finalizeUpload(
            operation.payload.uploadId,
            operation.payload.partPath,
            operation.payload.destinationPath,
            this.assets,
          )
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          if ((await this.staging.size(operation.payload.partPath)) > 0) throw error
          await this.assets.remove(operation.payload.destinationPath).catch(() => undefined)
          // Dropping the swap leaves the request on its old model, so put those assets back first.
          for (const asset of replaced) await this.assets.ensureMoved(asset.trashPath, asset.originalPath).catch(() => undefined)
          await this.repository.abandonOperation(operation.id)
          return
        }
        await this.repository.markOperationAssetsMoved(operation.id)
      }
      const id = await this.repository.completeAttachOperation(operation.id, operation.payload)
      await this.completeOnboardingTask(operation.payload.ownerId, 'upload')
      const purged = await Promise.allSettled(replaced.map((asset) => this.assets.purgeTrash(asset.trashPath)))
      if (purged.every((result) => result.status === 'fulfilled')) await this.repository.finishOperation(operation.id)
      return id
    }

    if (operation.payload.kind === 'repeat') {
      if (operation.state === 'prepared') {
        try {
          const source = await this.assets.read(operation.payload.sourcePath).catch((error) => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT')
              throw new Response(this.text.request.sourceModelNotFound, { status: 404 })
            throw error
          })
          const existing = await this.assets.stat(operation.payload.destinationPath)
          if (existing?.size !== source.size) {
            if (existing) await this.assets.remove(operation.payload.destinationPath)
            await this.assets.writeStream(operation.payload.destinationPath, source.stream, source.size)
          }
          await this.repository.markOperationAssetsMoved(operation.id)
        } catch (error) {
          await this.assets.remove(operation.payload.destinationPath).catch(() => undefined)
          await this.repository.abandonOperation(operation.id)
          throw error
        }
      }
      const id = await this.repository.completeRepeatOperation(operation.id, operation.payload)
      await this.repository.finishOperation(operation.id)
      return id
    }

    if (operation.state === 'prepared') {
      for (const asset of operation.payload.assets) {
        if (await this.nothingToMove(asset.originalPath, asset.trashPath)) continue
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
    if (!request) throw new Response(this.text.access.notFound, { status: 404 })
    return request
  }

  /** Rejects an empty batch, a card named twice, and a tag named twice for one card; a card without `tagIds` is any copies. */
  private assertUniqueCards(cards: { id: string; status: string; tagIds?: string[] }[], error: string) {
    const keys = cards.map(({ id, status, tagIds }) => `${id}:${status}:${tagIds ? printGroupCohortKey(tagIds) : '*'}`)
    if (
      cards.length === 0 ||
      new Set(keys).size !== cards.length ||
      cards.some(({ tagIds = [] }) => new Set(tagIds).size !== tagIds.length)
    ) {
      throw new Response(error, { status: 400 })
    }
  }

  private requestTrashAssets(request: PrintRequest, operationId: string) {
    return requestAssetPaths(request).map((originalPath) => ({
      originalPath,
      trashPath: this.assets.trashPath(operationId, originalPath),
    }))
  }

  // ensureMoved throws a raw Error when neither endpoint exists — the source
  // file is gone from storage and it was never moved to the destination. That
  // error is not a Response, so it slips past rpc() and surfaces to the browser
  // as an unhandled exception on a board action. When there is nothing left to
  // move, callers skip the physical move and let the logical change proceed.
  private async nothingToMove(source: string, destination: string) {
    const [sourceExists, destinationExists] = await Promise.all([this.assets.exists(source), this.assets.exists(destination)])
    return !sourceExists && !destinationExists
  }

  /** Records what one step used at today's prices, returning the transaction that undoes it. */
  async recordStepUsage(input: StepUsageInput, identity: Identity) {
    await this.requireUsageTracking(identity)
    const request = await this.repository.getRequest(input.requestId)
    if (!request) throw new Response(this.text.access.notFound, { status: 404 })
    const printers = await this.repository.listInventory('printers')
    const printer = input.printerId ? printers.find(({ id }) => id === input.printerId) : undefined
    if (input.printerId && !printer) throw new Response(this.text.request.unknownPrinter, { status: 400 })
    const consumables = await this.consumables()
    const material = input.consumableId ? consumables.find(({ id }) => id === input.consumableId) : undefined
    if (input.consumableId && !material) throw new Response(this.text.usage.unknownConsumable, { status: 400 })
    const assigned = request.printerId ? printers.find(({ id }) => id === request.printerId) : undefined
    const printType =
      printer?.printType ??
      assigned?.printType ??
      request.requestedPrintType ??
      (material && isPrintType(material.kind) ? material.kind : undefined)
    if (material && material.kind !== printType) throw new Response(this.text.usage.materialMismatch, { status: 400 })
    const items = await this.repository.listInventory('equipment')
    const equipment = unique(input.equipmentIds ?? []).map((id) => items.find((item) => item.id === id))
    if (equipment.some((item) => !item)) throw new Response(this.text.usage.unknownEquipment, { status: 400 })
    const rates = await this.rates()
    const drafts = stepUsageDrafts(input, {
      rates,
      printer,
      estimate: requestPrintEstimate({ ...request, printType, ...automaticEstimateFields(request, printType, rates) }),
      material,
      equipment: equipment.filter((item): item is EquipmentItem => item !== undefined),
      consumables,
    })
    const covering =
      input.stage === 'printing' && input.outcome !== 'failed'
        ? coveringPlateTransaction(
            await this.repository.listPlates(),
            await this.repository.printingUsage([request.id]),
            request.id,
            input.copies,
          )
        : undefined
    const recorded = covering ? await this.appendCoveredUsage(drafts, covering, identity) : await this.appendUsage(drafts, identity)
    this.capture(identity.id, 'usage_step_recorded', {
      stage: input.stage,
      print_type: printType,
      copy_count: input.copies,
      event_count: recorded.events.length,
      has_printer: Boolean(printer),
      has_material: Boolean(material),
      equipment_count: equipment.length,
      outcome: input.outcome,
    })
    return recorded
  }

  async recordStockMovement(input: StockMovementInput, identity: Identity) {
    await this.requireUsageTracking(identity)
    const consumable = (await this.consumables()).find(({ id }) => id === input.consumableId)
    if (!consumable) throw new Response(this.text.usage.unknownConsumable, { status: 400 })
    if (input.kind === 'replace' && input.printerId && !(await this.printer(input.printerId)))
      throw new Response(this.text.request.unknownPrinter, { status: 400 })
    const amount =
      input.kind === 'correction' ? input.counted - stockLevels([consumable], await this.repository.stockTotals())[0].onHand : input.amount
    const recorded = await this.appendUsage(
      [
        {
          stage: 'stock',
          kind: input.kind,
          ...(input.kind === 'replace' && input.printerId && { printerId: input.printerId }),
          ...consumed(consumable),
          amount,
        },
      ],
      identity,
    )
    this.capture(identity.id, 'stock_movement_recorded', { kind: input.kind, consumable_kind: consumable.kind })
    return recorded
  }

  async undoUsage(transactionId: string, identity: Identity) {
    await this.requireUsageTracking(identity)
    const undone = await this.repository.undoUsageTransaction(transactionId, Date.now())
    if (undone === 0) throw new Response(this.text.usage.nothingToUndo, { status: 404 })
    this.changed('usage.undone')
    this.capture(identity.id, 'usage_undone', { event_count: undone })
  }

  async listUsage(filters: UsageFilters, identity: Identity) {
    await this.requireUsageTracking(identity)
    return await this.repository.listUsage(filters)
  }

  /** Prefills from the most recent log window, so the step sheets need not load the whole log. */
  async usagePrefills(identity: Identity) {
    await this.requireUsageTracking(identity)
    return usagePrefills(
      await this.repository.listUsage({ limit: MAX_USAGE_LIST }),
      await this.repository.listInventory('printers'),
      await this.repository.listInventory('equipment'),
    )
  }

  async stockLevels(identity: Identity) {
    await this.requireUsageTracking(identity)
    return stockLevels(await this.consumables(), await this.repository.stockTotals())
  }

  /** Each charged print's whole-life cost and finish, so profit counts it once, against everything it used. */
  async chargedPrints(identity: Identity) {
    await this.requireUsageTracking(identity)
    return await this.repository.chargedPrints((await this.rates()).currency)
  }

  /** What filling in past prints would record, so the spend overview can offer it. */
  async usageBackfillPreview(identity: Identity) {
    await this.requireUsageTracking(identity)
    return backfillSummary(await this.pastPrintUsage())
  }

  /** Fills in every past print without usage from its estimate, as one transaction that undoes the whole fill. */
  async backfillUsage(identity: Identity): Promise<UsageBackfillSummary & { transactionId?: string }> {
    await this.requireUsageTracking(identity)
    const prints = await this.pastPrintUsage()
    const { transactionId, events } = await this.stampUsage(
      prints.flatMap(({ usedAt, drafts }) => drafts.map((draft) => ({ ...draft, createdAt: usedAt }))),
      identity,
    )
    const appended = new Set((await this.repository.appendUsageBackfill(events)).map(({ requestId }) => requestId))
    const summary = backfillSummary(prints.filter(({ requestId }) => appended.has(requestId)))
    if (summary.events === 0) return summary
    this.changed('usage.recorded')
    this.capture(identity.id, 'usage_backfilled', { print_count: summary.prints, copy_count: summary.copies, event_count: summary.events })
    return { ...summary, transactionId }
  }

  /** The workspace's plates, newest first, each print with what matching and splitting a slicer file need. */
  async listPlates(identity: Identity) {
    await this.requireUsageTracking(identity)
    const requests = new Map((await this.repository.listRequests()).map((request) => [request.id, request]))
    const printers = await this.repository.listInventory('printers')
    const estimateSettings = await this.rates()
    return (await this.repository.listPlates()).map((plate) => {
      const printTypes = unique(
        plate.items.map(({ requestId }) => {
          const request = requests.get(requestId)
          return request && (printers.find(({ id }) => id === request.printerId)?.printType ?? request.requestedPrintType)
        }),
      )
      const printType =
        printers.find(({ id }) => id === plate.printerId)?.printType ?? (printTypes.length === 1 ? printTypes[0] : undefined)
      return {
        ...plate,
        ...(printType && { printType }),
        items: plate.items.map((item) => {
          const request = requests.get(item.requestId)
          const estimate = request && this.platePrintEstimate(request, printType, printers, estimateSettings)
          return {
            ...item,
            name: request?.name ?? '',
            ...(request?.fileName && { fileName: request.fileName }),
            ...(request?.modelVolumeMm3 && { volumeMm3: request.modelVolumeMm3 }),
            ...(estimate && { estimatedMaterial: estimate }),
          }
        }),
      }
    })
  }

  async createPlate(input: { printerId?: string; otherStuff: boolean; items: PlateItem[] }, identity: Identity) {
    await this.requireUsageTracking(identity)
    const ids = new Set(input.items.map(({ requestId }) => requestId))
    if (input.items.length === 0 || input.items.length > MAX_PLATE_PRINTS || ids.size !== input.items.length)
      throw new Response(this.text.plates.invalid, { status: 400 })
    const printers = await this.repository.listInventory('printers')
    const printer = input.printerId ? printers.find(({ id }) => id === input.printerId) : undefined
    if (input.printerId && (!printer || printer.archived)) throw new Response(this.text.request.unknownPrinter, { status: 400 })
    for (const item of input.items) {
      const request = await this.repository.getRequest(item.requestId)
      if (!request) throw new Response(this.text.access.notFound, { status: 404 })
      if (!Number.isInteger(item.copies) || item.copies < 1 || item.copies > request.quantity)
        throw new Response(this.text.plates.invalid, { status: 400 })
      const printType = printers.find(({ id }) => id === request.printerId)?.printType ?? request.requestedPrintType
      if (printer && printType && printType !== printer.printType) throw new Response(this.text.usage.materialMismatch, { status: 400 })
    }
    const plate = await this.repository.createPlate({
      id: crypto.randomUUID(),
      ...(printer && { printerId: printer.id }),
      otherStuff: input.otherStuff,
      items: input.items.map(({ requestId, copies }) => ({ requestId, copies })),
      createdAt: Date.now(),
    })
    this.changed('plate.changed')
    this.capture(identity.id, 'plate_created', {
      print_count: input.items.length,
      copy_count: input.items.reduce((total, item) => total + item.copies, 0),
      has_printer: Boolean(printer),
      other_stuff: input.otherStuff,
    })
    return plate
  }

  async deletePlate(id: string, identity: Identity) {
    await this.requireUsageTracking(identity)
    if (!(await this.repository.deletePlate(id, Date.now()))) throw new Response(this.text.plates.notFound, { status: 404 })
    this.changed('plate.changed')
  }

  /**
   * Records what the plate used from the slicer, replacing anything it recorded before: the split goes to its prints as
   * measured usage that counts against stock, and replaces their printing usage from the step sheet or a fill-in.
   */
  async recordPlate(input: PlateRecordInput, identity: Identity) {
    await this.requireUsageTracking(identity)
    const plate = (await this.repository.listPlates()).find(({ id }) => id === input.plateId)
    if (!plate) throw new Response(this.text.plates.notFound, { status: 404 })
    this.validatePlateRecord(input, plate)
    const printers = await this.repository.listInventory('printers')
    const printer = printers.find(({ id }) => id === plate.printerId)
    const requests = await Promise.all(plate.items.map(({ requestId }) => this.repository.getRequest(requestId)))
    const printTypes = unique(
      requests.map((request) => request && (printers.find(({ id }) => id === request.printerId)?.printType ?? request.requestedPrintType)),
    )
    const printType = printer?.printType ?? (printTypes.length === 1 ? printTypes[0] : undefined)
    if (!printType) throw new Response(this.text.plates.printTypeUnknown, { status: 400 })
    // Slicer files weigh filament per object; a resin slicer's summary is typed in as totals.
    if (isMeasured(input) && printType === 'resin') throw new Response(this.text.plates.invalid, { status: 400 })
    const materials = await this.plateMaterials(input.materials, printType, identity)
    const rates = await this.rates()
    const split = splitPlate(
      input,
      input.minutes,
      plate.items.map((item, index) => {
        const request = requests[index]
        const estimate = request && this.platePrintEstimate(request, printType, printers, rates)
        return {
          requestId: item.requestId,
          copies: item.copies,
          ...(request?.modelVolumeMm3 && { volumeMm3: request.modelVolumeMm3 }),
          ...(estimate && { estimatedMaterial: estimate }),
        }
      }),
      materials.length,
    )
    const { transactionId, events } = await this.stampUsage(
      plateUsageDrafts(split, { plateId: plate.id, rates, printer, materials, consumables: await this.consumables() }),
      identity,
    )
    const replaced = Boolean(plate.recording)
    const at = Date.now()
    const recorded = await this.repository.recordPlate(plate.id, at, (current, printing) => ({
      recording: {
        transactionId,
        source: isMeasured(input) ? 'file' : 'totals',
        method: split.method,
        unit: printType === 'resin' ? 'ml' : 'g',
        minutes: input.minutes,
        otherAmount: split.other.amounts.reduce((total, amount) => total + amount, 0),
        overheadAmount: split.overhead,
        recordedAt: at,
      },
      items: split.prints.map(({ requestId, copies, amounts, minutes }) => ({
        requestId,
        copies,
        amount: amounts.reduce((total, amount) => total + amount, 0),
        minutes,
      })),
      events,
      superseded: current.items.flatMap(({ requestId, copies }) => supersededByPlate(printing, requestId, copies, transactionId)),
    }))
    if (!recorded) throw new Response(this.text.plates.notFound, { status: 404 })
    this.changed('usage.recorded')
    this.capture(identity.id, 'plate_recorded', {
      source: recorded.recording?.source,
      method: split.method,
      print_count: plate.items.length,
      filament_count: materials.length,
      object_count: isMeasured(input) ? input.objects.length : 0,
      matched_count: isMeasured(input) ? input.objects.filter((object) => object.requestId).length : 0,
      has_other: split.other.amounts.some((amount) => amount > 0),
      replaced,
    })
    return { plate: recorded, transactionId }
  }

  /** Records what a print was charged in the workspace currency, or clears it. */
  async setRequestCharge(requestId: string, amount: number | null, identity: Identity) {
    this.requireAdmin(identity)
    if (amount !== null && !(Number.isFinite(amount) && amount >= 0 && amount <= 1_000_000_000))
      throw new Response(this.text.plates.invalidCharge, { status: 400 })
    await this.requiredRequest(requestId)
    const { currency } = await this.rates()
    await this.repository.setRequestCharge(requestId, amount === null ? null : { amount, currency })
    this.changed('request.updated')
    this.capture(identity.id, 'print_charge_recorded', { has_amount: amount !== null })
  }

  private validatePlateRecord(input: PlateRecordInput, plate: Plate) {
    const onPlate = new Set(plate.items.map(({ requestId }) => requestId))
    const slots = input.materials.length
    const amount = (value: number) => Number.isFinite(value) && Math.abs(value) <= 1_000_000
    const valid =
      amount(input.minutes) &&
      input.minutes >= 0 &&
      slots >= 1 &&
      slots <= MAX_PLATE_FILAMENTS &&
      (isMeasured(input)
        ? input.objects.length <= MAX_PLATE_OBJECTS &&
          input.overhead.length === slots &&
          input.overhead.every(amount) &&
          input.objects.every((object) => object.amounts.length === slots && object.amounts.every(amount))
        : slots === 1 && amount(input.total) && input.total > 0 && input.otherShare >= 0 && input.otherShare < 1)
    if (!valid) throw new Response(this.text.plates.invalid, { status: 400 })
    if (isMeasured(input) && input.objects.some(({ requestId }) => requestId !== undefined && !onPlate.has(requestId)))
      throw new Response(this.text.plates.notOnPlate, { status: 400 })
  }

  /** The library material of each slot; one named on the spot joins the library, unpriced unless a price was given. */
  private async plateMaterials(choices: PlateMaterialChoice[], printType: PrintType, identity: Identity) {
    let library = await this.consumables()
    const materials: Consumable[] = []
    for (const choice of choices) {
      if ('consumableId' in choice) {
        const material = library.find(({ id }) => id === choice.consumableId)
        if (!material) throw new Response(this.text.usage.unknownConsumable, { status: 400 })
        if (material.kind !== printType) throw new Response(this.text.usage.materialMismatch, { status: 400 })
        materials.push(material)
        continue
      }
      const name = choice.name.trim()
      // No price is stored as zero, which records usage unpriced and leaves the library asking for one.
      const price = choice.price ?? 0
      const created: Consumable =
        printType === 'resin'
          ? { id: crypto.randomUUID(), kind: 'resin', name, pricePerLitre: price, densityGramsPerMl: TYPICAL_RESIN_DENSITY_GRAMS_PER_ML }
          : { id: crypto.randomUUID(), kind: 'filament', name, pricePerKg: price }
      library = await this.changeInventory('consumables', identity, (items) => [...items, created])
      materials.push(created)
    }
    return materials
  }

  /** A print's material estimate per copy in the plate's print type, which a typed plate total is split by. */
  private platePrintEstimate(
    request: PrintRequest,
    printType: PrintType | undefined,
    printers: PrinterProfile[],
    settings: MaterialEstimateSettings,
  ) {
    const type = printType ?? printers.find(({ id }) => id === request.printerId)?.printType ?? request.requestedPrintType
    return type
      ? requestPrintEstimate({ ...request, printType: type, ...automaticEstimateFields(request, type, settings) })?.material
      : undefined
  }

  async createInventoryItem<Kind extends InventoryKind>(kind: Kind, item: InventoryItems[Kind], identity: Identity) {
    return await this.changeInventory(kind, identity, (items) => {
      if (items.some(({ id }) => id === item.id)) throw new Response(this.text.inventory.exists, { status: 409 })
      return [...items, { ...item, archived: undefined }]
    })
  }

  /** Stores an edit to one item; archiving has its own action, so the item stays archived or active as it is. */
  async updateInventoryItem<Kind extends InventoryKind>(kind: Kind, item: InventoryItems[Kind], identity: Identity) {
    return await this.changeInventory(kind, identity, (items) =>
      this.replacingItem(items, item.id, (stored) => ({ ...item, archived: stored.archived })),
    )
  }

  async setInventoryItemArchived(kind: InventoryKind, id: string, archived: boolean, identity: Identity) {
    return await this.changeInventory(kind, identity, (items) =>
      this.replacingItem(items, id, (stored) => ({ ...stored, archived: archived || undefined })),
    )
  }

  /** What names an item, so the confirmation before deleting it can say what loses the link. */
  async inventoryReferences(kind: InventoryKind, id: string, identity: Identity) {
    this.requireAdmin(identity)
    return await this.repository.inventoryReferences(kind, id)
  }

  /** Deletes an archived item for good; usage keeps its name and cost, and the rest that named it loses the link. */
  async deleteInventoryItem(kind: InventoryKind, id: string, identity: Identity) {
    this.requireAdmin(identity)
    const { item, references, items } = await this.repository.deleteInventoryItem(kind, id, (stored) => {
      if (!stored) throw new Response(this.text.inventory.notFound, { status: 404 })
      if (!canDeleteInventoryItem(stored)) throw new Response(this.text.inventory.notArchived, { status: 409 })
    })
    this.changed('inventory.deleted')
    this.capture(identity.id, 'inventory_item_deleted', {
      inventory_kind: kind,
      item_kind: deletedItemKind(kind, item),
      request_count: references.requests,
      plate_count: references.plates,
      usage_count: references.usage,
      stock_count: references.stock,
      equipment_count: references.supplies,
      part_count: references.parts,
    })
    return items
  }

  async skipPrinterSetup(identity: Identity) {
    this.requireAdmin(identity)
    await this.repository.setSetting(PRINTERS_SKIPPED_SETTING, true)
    this.changed('settings.changed')
  }

  private replacingItem<Item extends { id: string; archived?: boolean }>(items: Item[], id: string, replace: (stored: Item) => Item) {
    if (!items.some((item) => item.id === id)) throw new Response(this.text.inventory.notFound, { status: 404 })
    return items.map((item) => (item.id === id ? replace(item) : item))
  }

  private async changeInventory<Kind extends InventoryKind>(
    kind: Kind,
    identity: Identity,
    change: (items: InventoryItems[Kind][]) => InventoryItems[Kind][],
  ) {
    this.requireAdmin(identity)
    const { previous, items } = await this.repository.changeInventory(kind, (current) => {
      const next = change(current)
      this.validateInventory(kind, current, next)
      return next
    })
    this.changed('inventory.changed')
    this.captureInventory(kind, identity.id, previous, items)
    return items
  }

  /** Checks only what the change touched, so an item stored before a rule existed never blocks editing another. */
  private validateInventory<Kind extends InventoryKind>(kind: Kind, previous: InventoryItems[Kind][], next: InventoryItems[Kind][]) {
    const active = activeItems(next).length
    if (active > INVENTORY_LIMITS[kind] && active > activeItems(previous).length)
      throw new Response(this.text.inventory.full(INVENTORY_LIMITS[kind]), { status: 409 })
    if (kind !== 'printers') return
    const stored = new Map(previous.map((item) => [item.id, JSON.stringify(item)]))
    for (const printer of next as PrinterProfile[]) {
      if (stored.get(printer.id) === JSON.stringify(printer)) continue
      const error = printerValidationError(printer, next as PrinterProfile[], this.messages())
      if (error) throw new Response(error, { status: 400 })
    }
  }

  private captureInventory<Kind extends InventoryKind>(
    kind: Kind,
    identity: string,
    previous: InventoryItems[Kind][],
    items: InventoryItems[Kind][],
  ) {
    if (kind === 'printers') {
      this.capture(identity, 'printer_saved', {
        printer_count: activeItems(items).length,
        ...printerProfileChanges(previous as PrinterProfile[], items as PrinterProfile[]),
      })
    } else if (kind === 'equipment') {
      const active = activeItems(items as EquipmentItem[])
      this.capture(identity, 'equipment_saved', {
        equipment_count: active.length,
        catalogue_count: active.filter((item) => item.presetId).length,
        with_supplies_count: active.filter((item) => item.supplies.length).length,
      })
    } else {
      const library = items as Consumable[]
      this.capture(identity, 'consumables_saved', {
        resin_count: consumablesOfKind(library, 'resin').length,
        filament_count: consumablesOfKind(library, 'filament').length,
        part_count: consumablesOfKind(library, 'part').length,
        supply_count: consumablesOfKind(library, 'supply').length,
      })
    }
  }

  /** Only admins record, read, or undo usage, and only while the workspace tracks it; turning tracking off keeps the log. */
  private async requireUsageTracking(identity: Identity) {
    this.requireAdmin(identity)
    if (!(await storedUsageTracking(this.repository))) throw new Response(this.text.usage.trackingOff, { status: 409 })
  }

  private async consumables() {
    return await this.repository.listInventory('consumables')
  }

  private async appendUsage(drafts: UsageDraft[], identity: Identity) {
    const { transactionId, events } = await this.stampUsage(drafts, identity)
    await this.repository.appendUsageEvents(events)
    if (events.length) this.changed('usage.recorded')
    return { transactionId: events.length ? transactionId : undefined, events }
  }

  /** A printing step for copies a recorded plate already measured: kept in the log, but replaced by the plate from the start. */
  private async appendCoveredUsage(drafts: UsageDraft[], supersededBy: string, identity: Identity) {
    const { events } = await this.stampUsage(drafts, identity)
    await this.repository.appendUsageEvents(events.map((event) => ({ ...event, undoneAt: event.createdAt, supersededBy })))
    return { transactionId: undefined, events: [], coveredByPlate: true }
  }

  /** One action's events under one transaction, priced in today's currency and dated now unless a draft says when. */
  private async stampUsage(drafts: (UsageDraft & { createdAt?: number })[], identity: Identity) {
    const transactionId = crypto.randomUUID()
    const now = Date.now()
    const { currency } = await this.rates()
    const events: UsageEvent[] = drafts.map((draft) => ({
      createdAt: now,
      ...draft,
      id: crypto.randomUUID(),
      transactionId,
      userId: identity.id,
      ...(draft.unitPrice !== undefined && { currency }),
    }))
    return { transactionId, events }
  }

  private async pastPrintUsage() {
    return usageBackfill(await this.repository.listRequests(), {
      rates: await this.rates(),
      printers: await this.repository.listInventory('printers'),
      consumables: await this.consumables(),
      recorded: new Set(await this.repository.usageRequestIds()),
    })
  }

  /** The business rates usage is priced at now. */
  private async rates(): Promise<PriceCalculatorSettings> {
    return {
      ...DEFAULT_PRICE_CALCULATOR_SETTINGS,
      ...(await this.repository.getSetting<Partial<PriceCalculatorSettings>>(PRICE_CALCULATOR_SETTING)),
    }
  }

  private requireAdmin(identity: Identity) {
    if (identity.role !== 'admin') throw new Response(this.text.access.forbidden, { status: 403 })
  }

  private async printer(id: string) {
    return (await this.repository.listInventory('printers')).find((printer) => printer.id === id)
  }

  private async resolveTarget(
    requestedPrintType?: PrintType | null,
    printerId?: string | null,
    excludeRequestId?: string,
    modelDimensions?: import('./types').ModelDimensions,
    currentPrintType?: PrintType,
  ) {
    await this.validateTarget(requestedPrintType, printerId, currentPrintType)
    if (printerId || !requestedPrintType) {
      return { requestedPrintType: undefined, printerId: printerId ?? undefined, automaticPrinterAssignment: false }
    }
    const profiles = await this.repository.listInventory('printers')
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

  private async validateTarget(requestedPrintType?: PrintType | null, printerId?: string | null, currentPrintType?: PrintType) {
    if (requestedPrintType && printerId) throw new Response(this.text.request.printerOrPrintType, { status: 400 })
    // A print keeps the type it already has, so narrowing what the workspace prints never invalidates existing prints.
    if (
      requestedPrintType &&
      requestedPrintType !== currentPrintType &&
      !(await storedWorkspacePrintTypes(this.repository)).includes(requestedPrintType)
    )
      throw new Response(this.text.request.printTypeNotOffered, { status: 400 })
    if (!printerId) return
    const printer = await this.printer(printerId)
    if (!printer) throw new Response(this.text.request.unknownPrinter, { status: 400 })
    if (printer.archived) throw new Response(this.text.request.printerArchived, { status: 400 })
  }

  private async requestPrintType(request: { requestedPrintType?: PrintType; printerId?: string }) {
    const printer = request.printerId ? await this.printer(request.printerId) : undefined
    return printer ? printer.printType : request.requestedPrintType
  }

  async notificationPreferences(identity: Identity): Promise<NotificationPreferences> {
    const preferences = await this.repository.notificationPreferences(identity.id)
    if (!preferences) throw new Response(this.text.access.forbidden, { status: 403 })
    return preferences
  }

  async setNotificationPreference(kind: NotificationKind, enabled: boolean, identity: Identity) {
    if (!(await this.repository.notificationPreferences(identity.id))) throw new Response(this.text.access.forbidden, { status: 403 })
    await this.repository.setNotificationPreference(identity.id, kind, enabled)
    this.changed('settings.changed')
    this.capture(identity.id, 'notification_preference_changed', { kind, enabled })
    return await this.notificationPreferences(identity)
  }

  private async notifyReady(moves: { request: PrintRequest; to: string; count: number }[], actor: Identity) {
    const ready = moves.filter(({ to }) => isReadyStatus(to))
    if (!this.notifier || ready.length === 0 || !(await this.notifier.canSend())) return
    const requesters = readyPrintsByRequester(
      ready.map(({ request, count }) => ({ requestId: request.id, name: request.name, ownerUserId: request.ownerUserId, count })),
      actor.id,
    )
    for (const [ownerUserId, prints] of requesters) {
      if (!(await this.repository.notificationPreferences(ownerUserId))?.['print-ready']) continue
      const { ownerEmail: email, ownerName: name } = ready.find(({ request }) => request.ownerUserId === ownerUserId)!.request
      void this.notifier.printsReady({ id: ownerUserId, email, name }, prints).catch(() => undefined)
    }
  }

  private changed(event: AppEvent) {
    this.events.publish(event)
  }

  private async completeOnboardingTask(userId: string, task: OnboardingTaskId) {
    await recordOnboardingTask(this.repository, userId, task).catch(() => undefined)
  }

  private capture(identity: string, event: string, properties?: Record<string, unknown>) {
    this.telemetry.capture(identity, event, properties)
  }
}

function unique<T extends string | undefined>(values: T[]) {
  return [...new Set(values)]
    .filter((value): value is Exclude<T, undefined> => value !== undefined)
    .sort((left, right) => left.localeCompare(right))
}

function filterAndSortEstimates(requests: PublicPrintRequest[], filters: RequestFilters) {
  const hasMaterialRange = filters.minEstimatedMaterial !== undefined || filters.maxEstimatedMaterial !== undefined
  const filtered = !hasMaterialRange
    ? requests
    : requests.filter((request) => {
        const material = effectiveEstimate(request, 'material')
        return (
          Number.isFinite(material) &&
          material >= (filters.minEstimatedMaterial ?? 0) &&
          material <= (filters.maxEstimatedMaterial ?? Number.POSITIVE_INFINITY)
        )
      })
  const sort = filters.sort
  if (!sort?.startsWith('material-') && !sort?.startsWith('time-')) return filtered
  const field = sort.startsWith('material-') ? 'material' : 'time'
  const direction = sort.endsWith('-asc') ? 1 : -1
  return [...filtered].sort((left, right) => {
    const leftValue = effectiveEstimate(left, field)
    const rightValue = effectiveEstimate(right, field)
    if (!Number.isFinite(leftValue)) return Number.isFinite(rightValue) ? 1 : right.createdAt - left.createdAt
    if (!Number.isFinite(rightValue)) return -1
    return (leftValue - rightValue) * direction || right.createdAt - left.createdAt
  })
}

function effectiveEstimate(request: PublicPrintRequest, field: 'material' | 'time') {
  return field === 'material'
    ? (request.estimatedMaterialOverride ?? request.automaticEstimatedMaterial ?? Number.POSITIVE_INFINITY)
    : (request.estimatedPrintMinutesOverride ?? request.automaticEstimatedPrintMinutes ?? Number.POSITIVE_INFINITY)
}
