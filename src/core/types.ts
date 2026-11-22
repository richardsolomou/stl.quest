import type { ModelFormat } from './assetKeys'
import type { StoragePlan } from './plans'
import type { NotificationKind, NotificationPreferences } from './notifications'
import type { OnboardingProgress } from './onboarding'
import type { Locale } from './i18n/locales'
import type { MaintenanceTotals } from './maintenance'
import type { StockTotal, UsageEvent, UsageFilters } from './usage'
import type { InventoryItems, InventoryKind } from './inventory'
import type { RecentStockUse } from './shopping'
import type { InventoryReferences } from './inventoryDeletion'
import type { Plate, PlateItem, PlateRecording, PlateRunStage } from './plates'
import type { PrintJob } from './printJobs'
import type { PriceCalculatorCurrency } from './priceCalculator'
import type { ChargedPrint } from './spend'
import type { SpoolmanChange, SpoolmanLink, SpoolmanSpool } from './spoolman'
import type { SpoolmanRestock, SpoolmanRestockResult } from './spoolmanRestocks'
import type { SlicerId } from './slicers'

export type Role = 'admin' | 'requester'
export type AccountRole = 'super_admin' | 'requester'
export type WorkspaceRole = 'owner' | 'admin' | 'member'
export type AssignableWorkspaceRole = Exclude<WorkspaceRole, 'owner'>
export const PRINT_TYPES = ['resin', 'filament'] as const
export type PrintType = (typeof PRINT_TYPES)[number]

export function isPrintType(value: unknown): value is PrintType {
  return (PRINT_TYPES as readonly unknown[]).includes(value)
}

export type WorkspaceSummary = {
  id: string
  name: string
  slug: string
  role: WorkspaceRole
}

export type Identity = {
  id: string
  email: string
  name: string
  image?: string
  role: Role
  workspaceRole?: WorkspaceRole
  workspaceId?: string
  workspaceSlug?: string
  twoFactorEnabled?: boolean
  impersonatedBy?: string
  superAdmin?: boolean
  /** The user's chosen interface language; undefined follows the browser. */
  locale?: Locale
}

export type Account = Pick<Identity, 'id' | 'email' | 'name' | 'image'> & {
  role: AccountRole
  createdAt: number
  updatedAt: number
  lastOnlineAt?: number
  workspaceCount: number
  plan?: StoragePlan
  managedStorageUsedBytes?: number
  managedStorageQuotaBytes?: number
  managedStorageWorkspaceCount?: number
}

export type Person = { id: string; name: string; color?: string }
export type PrinterSummary = {
  id: string
  name: string
  printType: PrintType
}
export type ModelDimensions = { widthMm: number; depthMm: number; heightMm: number }
export type PrinterProfile = PrinterSummary & {
  presetId?: string
  widthMm?: number
  depthMm?: number
  heightMm?: number
  /** For wear: what the printer cost and how many print hours it lasts. */
  purchasePrice?: number
  lifespanHours?: number
  /** The calendar day it was bought (`YYYY-MM-DD`), for its age. */
  purchasedOn?: string
  /** What a printer without a catalogue model draws while printing; a catalogue model's own power is used otherwise. */
  powerWatts?: number
  /** Catalogue equipment bolted onto this printer, such as a pulsing release module, whose printing power adds to its own. */
  addOnPresetIds?: string[]
  /** Which slicer this printer's files open in (see `SLICERS`). */
  slicer?: SlicerId
  archived?: boolean
}

export type Invite = {
  id: string
  workspaceId?: string
  role: Role
  label?: string
  recipientEmail?: string
  createdAt: number
  expiresAt: number
  usedAt?: number
}

export type PrintRequest = {
  id: string
  /** Counts up per workspace and makes the request's tag (see `requestTag`). */
  number: number
  name: string
  fileName?: string
  filePath?: string
  quantity: number
  ownerUserId: string
  ownerEmail: string
  ownerName: string
  counts: Record<string, number>
  orders: Record<string, number | undefined>
  completedAt?: number
  archivedAt?: number
  /** When the request was last moved back from the archive; automatic archiving waits its full delay again from here. */
  unarchivedAt?: number
  notes?: string
  sourceUrl?: string
  sourceImageUrl?: string
  sourceImagePath?: string
  thumbnailPath?: string
  previewPath?: string
  hasThumbnail: boolean
  requestedPrintType?: PrintType
  printerId?: string
  automaticPrinterAssignment?: boolean
  modelDimensions?: ModelDimensions
  modelVolumeMm3?: number
  modelSurfaceAreaMm2?: number
  estimatedMaterialOverride?: number
  estimatedPrintMinutesOverride?: number
  /** What the customer was charged, recorded by an admin; only admins see it. */
  charged?: PrintCharge
  createdAt: number
  updatedAt: number
}

export type PrintCharge = { amount: number; currency: PriceCalculatorCurrency }

export type PrintGroupItem = { requestId: string; status: string; count: number; order: number }
export const printGroupColors = [
  'blue',
  'green',
  'amber',
  'violet',
  'rose',
  'cyan',
  'orange',
  'lime',
  'fuchsia',
  'sky',
  'teal',
  'indigo',
] as const
export type PrintGroupColor = (typeof printGroupColors)[number]
/** Adds and removes tags on the listed copies, optionally creating one new tag; each item is one request's copies in one stage. */
export type CopyTagEdit = {
  createTagName?: string
  addTagIds: string[]
  removeTagIds: string[]
  items: { requestId: string; status: string; count: number }[]
}
export type PrintGroup = {
  id: string
  name: string
  color: PrintGroupColor
  parentId?: string
  status: string
  items: PrintGroupItem[]
  createdAt: number
  updatedAt: number
}

export function requestQueueOrder(request: Pick<PrintRequest, 'orders' | 'createdAt'>, status: string) {
  return request.orders[status] ?? -request.createdAt
}

export type PublicPrintRequest = Omit<
  PrintRequest,
  | 'fileName'
  | 'filePath'
  | 'ownerUserId'
  | 'ownerEmail'
  | 'ownerName'
  | 'sourceImageUrl'
  | 'sourceImagePath'
  | 'thumbnailPath'
  | 'previewPath'
  | 'requestedPrintType'
  | 'automaticPrinterAssignment'
  | 'modelDimensions'
  | 'modelVolumeMm3'
  | 'modelSurfaceAreaMm2'
> & {
  requesterId: string
  requesterImage?: string
  requesterName: string
  mine: boolean
  canEdit: boolean
  canDelete: boolean
  canArchive: boolean
  hasFile: boolean
  modelFormat?: ModelFormat
  hasSourceImage: boolean
  hasPreview: boolean
  printType?: PrintType
  requestedPrintType?: PrintType
  printer?: PrinterSummary
  fitState?: 'pending' | 'selected_printer' | 'another_compatible_printer' | 'none'
  automaticEstimatedMaterial?: number
  automaticEstimatedPrintMinutes?: number
  estimatedMaterialUnit?: 'g' | 'ml'
  estimateGeometryStatus?: AssetGenerationJob['status']
  groups: { id: string; name: string; color: PrintGroupColor; parentId?: string; status: string; count: number }[]
}

export type AssetGenerationStage = 'geometry' | 'thumbnail' | 'preview'
/** `storage` failures are requeued when the workspace runtime next starts; `permanent` ones stay terminal. */
export type AssetGenerationFailureKind = 'permanent' | 'storage'
export type AssetGenerationOutcome =
  | { status: 'ready' | 'skipped'; path?: string; error?: string }
  | { status: 'failed'; error: string; failureKind: AssetGenerationFailureKind }
export type AssetGenerationJob = {
  requestId: string
  stage: AssetGenerationStage
  status: 'pending' | 'running' | 'ready' | 'skipped' | 'failed'
  error?: string
  failureKind?: AssetGenerationFailureKind
  queuedAt: number
  startedAt?: number
  finishedAt?: number
}

export const REQUEST_SORTS = [
  'fair',
  'updated-desc',
  'updated-asc',
  'created-desc',
  'created-asc',
  'name-asc',
  'name-desc',
  'quantity-desc',
  'quantity-asc',
  'material-desc',
  'material-asc',
  'time-desc',
  'time-asc',
  'archived-desc',
  'archived-asc',
] as const
export type RequestSort = (typeof REQUEST_SORTS)[number]

export type BoardSort = RequestSort | 'round-robin'

export type RequestFilters = {
  query?: string
  requester?: string
  minQuantity?: number
  maxQuantity?: number
  minEstimatedMaterial?: number
  maxEstimatedMaterial?: number
  createdAfter?: number
  createdBefore?: number
  updatedAfter?: number
  updatedBefore?: number
  hasNotes?: boolean
  hasSource?: boolean
  hasThumbnail?: boolean
  hasPreview?: boolean
  printType?: PrintType
  printerId?: string | null
  sort?: RequestSort
  /** Archive view: only archived requests. Without it, archived requests are excluded. */
  archived?: boolean
}

export type RequestFacets = {
  requesters: { value: string; label: string; count: number }[]
  total: number
  available: number
}

export type RequestQuery = {
  filters?: RequestFilters
  visibleToUserId?: string
  ownerUserId?: string
  searchPrivateMetadata?: boolean
  /** Include archived requests regardless of filters (administrative sweeps). */
  includeArchived?: boolean
}

export type RequestQueryResult = { requests: PrintRequest[]; facets: RequestFacets }
export type PublicRequestQueryResult = { requests: PublicPrintRequest[]; groups: PrintGroup[]; facets: RequestFacets }

/** What a workspace member may see on the board: only their own requests, or all of them. */
export type MemberRequestVisibility = 'own' | 'all'

export type BoardConfig = {
  privateRequests: boolean
  /** Per-member overrides of the workspace default, keyed by user id. Absent members follow the default. */
  memberVisibility: Record<string, MemberRequestVisibility>
  /** Archive requests this many days after every copy is Ready. Absent means off. */
  autoArchiveDays?: number
  /** Prints wait on their print type until someone picks a printer. Absent means printers are assigned automatically. */
  manualPrinterAssignment?: true
}

export type NewPrintRequest = Pick<
  PrintRequest,
  | 'name'
  | 'fileName'
  | 'filePath'
  | 'quantity'
  | 'ownerUserId'
  | 'notes'
  | 'sourceUrl'
  | 'sourceImageUrl'
  | 'sourceImagePath'
  | 'thumbnailPath'
  | 'previewPath'
  | 'printerId'
  | 'requestedPrintType'
  | 'automaticPrinterAssignment'
>

export type MoveOperation = {
  kind: 'move'
  requestId: string
  fromStatus: string
  toStatus: string
  count: number
  order?: number
  movedAt?: number
  sourcePath: string
  destinationPath: string
}

export type DeleteOperation = {
  kind: 'delete'
  requestId: string
  ownerUserId?: string
  purgeBeforeDelete?: boolean
  assets: { originalPath: string; trashPath: string }[]
}

export type UploadOperation = {
  kind: 'upload'
  uploadId: string
  ownerId: string
  requestId: string
  partPath: string
  destinationPath: string
  request: Omit<NewPrintRequest, 'filePath' | 'previewPath' | 'thumbnailPath'>
}

/** Puts a model file on an existing request, so its assets land the same way an upload's do. */
export type AttachOperation = {
  kind: 'attach'
  uploadId: string
  ownerId: string
  requestId: string
  partPath: string
  destinationPath: string
  fileName: string
  /** Set when the file replaces one the request already had: the assets it supersedes, staged for the trash. */
  replaced?: { originalPath: string; trashPath: string }[]
}

export type RepeatOperation = {
  kind: 'repeat'
  requestId: string
  newRequestId: string
  sourcePath: string
  destinationPath: string
  request: Omit<NewPrintRequest, 'filePath' | 'previewPath' | 'thumbnailPath'>
}

export type OperationPayload = MoveOperation | DeleteOperation | UploadOperation | AttachOperation | RepeatOperation
export type PendingOperation = { id: string; state: 'prepared' | 'assets_moved' | 'committed'; payload: OperationPayload }

export type NewPlate = {
  id: string
  printerId?: string
  otherStuff: boolean
  items: PlateItem[]
  stage?: PlateRunStage
  createdAt: number
}

/**
 * Moves `count` copies of a print between stages with the tags they carry. Naming `tagIds` moves copies of the board
 * card carrying exactly those tags (an empty list is the untagged card); omitting it moves copies of any cards, those
 * with the fewest tags first.
 */
export type CopyMove = {
  id: string
  from: string
  to: string
  count: number
  tagIds?: string[]
  filePath?: string
  order?: number
  movedAt?: number
}

interface RepositoryShape {
  listRequests(): PrintRequest[]
  queryRequests(query?: RequestQuery): RequestQueryResult
  getRequest(id: string): PrintRequest | undefined
  listGroups(): PrintGroup[]
  getGroup(id: string): PrintGroup | undefined
  createGroup(
    name: string,
    status: string,
    color: PrintGroupColor,
    items: Omit<PrintGroupItem, 'order' | 'status'>[],
    parentId?: string,
  ): string
  updateGroup(id: string, fields: { name?: string; color?: PrintGroupColor; parentId?: string | null }): void
  updateCopyTags(edit: Omit<CopyTagEdit, 'createTagName'>, createTag?: { name: string; color: PrintGroupColor }): string | undefined
  deleteGroup(id: string): void
  reorderGroupItem(groupId: string, status: string, requestId: string, targetRequestId: string, edge: 'before' | 'after'): void
  moveGroup(id: string, from: string, to: string, inputs: CopyMove[]): void
  createRequest(request: NewPrintRequest): string
  createUploadSession(
    uploadId: string,
    ownerId: string,
    expiresAt: number,
    maxIncomplete: number,
    idleBefore?: number,
  ): { fresh: boolean; completedRequestId?: string }
  reserveUpload(
    uploadId: string,
    ownerId: string,
    bytes: number,
    expiresAt: number,
    limits: { count: number; bytes: number; managedBytes?: number },
  ): boolean
  expireUploads(now: number): string[]
  activeUploadIds(now: number): Set<string>
  hasActiveUploads(now: number): boolean
  incompleteUploadStats(now: number): { count: number; bytes: number }
  reconcileManagedStorageUsage(persistedBytes: number): void
  reserveManagedAssetBytes(bytes: number, quota: number): boolean
  finishManagedAssetReservation(reservedBytes: number, persistedDelta: number): void
  beginManagedUploadFinalize(uploadId: string): number
  finishManagedUploadFinalize(uploadId: string, persistedDelta: number): void
  managedStorageRemaining(quota: number, owner?: string): number
  managedStorageEntitlementCount(ownerId: string): number
  managedStoragePlan(ownerId?: string): StoragePlan
  managedStorageOwnerId(): string | undefined
  claimManagedStorage(ownerId: string, workspaceLimit: number): boolean
  releaseManagedStorage(): void
  workspaceOwnerId(): string | undefined
  managedStorageEligible(ownerId: string, workspaceLimit: number): boolean
  uploadIdsOwnedBy(ownerId: string): string[]
  refreshUploadSession(uploadId: string, ownerId: string, expiresAt: number, size: number): boolean
  canCancelUpload(uploadId: string, ownerId: string): boolean
  releaseUploadSession(uploadId: string, ownerId: string): void
  deleteUploadSessions(ownerId: string): void
  getCompletedUpload(uploadId: string, ownerId: string): string | undefined
  updateRequestFilePath(id: string, previousPath: string, nextPath: string): boolean
  moveCopies(input: CopyMove): void
  /** Moves every copy move together, all or nothing; several moves may take different cards of one print and stage. */
  moveCopiesBatch(inputs: CopyMove[]): void
  reorderRequest(id: string, order: number): void
  updateRequest(
    id: string,
    fields: {
      name?: string
      quantity?: number
      notes?: string
      sourceUrl?: string
      sourceImageUrl?: string | null
      sourceImagePath?: string | null
      requestedPrintType?: PrintType | null
      printerId?: string | null
      automaticPrinterAssignment?: boolean
      estimatedMaterialOverride?: number | null
      estimatedPrintMinutesOverride?: number | null
    },
  ): void
  deleteRequest(id: string): void
  setRequestsArchived(ids: string[], archivedAt: number | null): void
  /** Locks the requests, then archives those `due` still selects, so a concurrent move or sweep cannot interleave. */
  archiveRequestsStillDue(
    ids: string[],
    archivedAt: number,
    due: (requests: Pick<PrintRequest, 'id' | 'counts' | 'completedAt' | 'archivedAt' | 'unarchivedAt'>[]) => string[],
  ): string[]
  /** Deletes `count` copies carrying exactly `tagIds` (none when omitted) from each print and stage, all or nothing. */
  deleteCopiesBatch(inputs: { id: string; status: string; count: number; tagIds?: string[]; deleteRequest: boolean }[]): void
  requestsNeedingAssets(): string[]
  assetGenerationCandidates(afterId: string | undefined, limit: number): string[]
  queueAssetGeneration(id: string): void
  requeueAssetGeneration(id: string, stages: AssetGenerationStage[]): void
  startAssetGeneration(id: string, stages: AssetGenerationStage[]): void
  finishAssetGeneration(id: string, stage: AssetGenerationStage, outcome: AssetGenerationOutcome): void
  listAssetGenerationJobs(stage?: AssetGenerationStage): AssetGenerationJob[]
  assetGenerationJobs(id: string): AssetGenerationJob[]
  requeueInterruptedAssetGeneration(): void
  /** Requests with a stage that failed on storage, ordered by their latest failure so a stuck print cannot starve the rest. */
  storageFailedAssetGenerationRequests(limit: number): string[]
  /** Requeues storage-failed stages for the given requests, or for every request when none are given. */
  requeueStorageFailedAssetGeneration(requestIds?: string[]): void
  setModelDimensions(id: string, dimensions: ModelDimensions, volumeMm3?: number, surfaceAreaMm2?: number): void
  completeAssetGeneration(id: string, generated: { thumbnailPath?: string; previewPath?: string }): void
  recordSourceImagePath(id: string, path: string | null): void
  listPeople(): Person[]
  /** Returns whether a membership was removed; a non-member is a no-op. */
  removeWorkspaceMember(userId: string): boolean
  /** Returns whether a membership was created; an existing membership keeps its role. */
  addWorkspaceMember(userId: string, role: WorkspaceRole): boolean
  listUsers(): Identity[]
  listMemberActivity(): { userId: string; lastActiveAt: number }[]
  recordMemberActivity(userId: string, now: number): void
  listAccounts(): Account[]
  userExists(userId: string): boolean
  accountExists(email: string): boolean
  createInvite(invite: { id: string; tokenHash: string; role: Role; label?: string; recipientEmail?: string; expiresAt: number }): void
  listInvites(): Invite[]
  findInvite(tokenHash: string): Invite | undefined
  claimInvite(tokenHash: string, now: number): Invite | undefined
  completeInvite(id: string, userId: string): void
  deleteInvite(id: string): void
  spoolmanConnection(): { createdAt: number; receivedAt?: number } | undefined
  /** Stores the hash of a new token, which replaces the old one and keeps the spools already received. */
  connectSpoolman(tokenHash: string, now: number): void
  /** Forgets the token and every spool received with it; links to library filaments stay. */
  disconnectSpoolman(): void
  listSpoolmanSpools(): SpoolmanSpool[]
  /**
   * Applies what Spoolman sent and stamps when it arrived, unless the workspace has disconnected meanwhile or a new spool
   * would take it past `maxSpools`; `first` says whether it is the first since connecting.
   */
  receiveSpoolman(
    change: SpoolmanChange,
    now: number,
    maxSpools: number,
  ): { received: false; full?: boolean } | { received: true; first: boolean }
  listSpoolmanLinks(): SpoolmanLink[]
  /** Links the Spoolman filament to a library filament or to none, or with no link hands it back to matching. */
  setSpoolmanLink(filamentId: number, link: { consumableId: string | null } | undefined, now: number): void
  /** Spools to add to Spoolman, newest first. */
  listSpoolmanRestocks(): SpoolmanRestock[]
  /**
   * Queues spools for the bridge to add to Spoolman, keeping at most `limit` of those already added; false when the
   * workspace is not connected or more than `limit` would wait.
   */
  queueSpoolmanRestocks(restocks: SpoolmanRestock[], limit: number): boolean
  /** Records what the bridge did with a spool not yet added; false when there is none such. */
  settleSpoolmanRestock(result: SpoolmanRestockResult, now: number): boolean
  /** Queues a spool Spoolman refused again; false when it did not fail. */
  retrySpoolmanRestock(id: string, now: number): boolean
  deleteSpoolmanRestock(id: string): boolean
  getSetting<T>(key: string): T | undefined
  listAssetMigrations(): string[]
  recordAssetMigration(id: string): void
  setSetting(key: string, value: unknown): void
  setSettings(values: Record<string, unknown>, deleteKeys?: string[]): void
  setSettingsAndReleaseManagedStorage(values: Record<string, unknown>, deleteKeys?: string[]): void
  deleteSetting(key: string): void
  /** Appends every event in one transaction. */
  appendUsageEvents(events: UsageEvent[]): void
  /** Appends, in one transaction, the events of prints that still have no live usage, and returns those it appended. */
  appendUsageBackfill(events: UsageEvent[]): UsageEvent[]
  /** Prints with live usage. */
  usageRequestIds(): string[]
  listUsage(filters: UsageFilters): UsageEvent[]
  /** Live events summed per consumable, kind, and unit, leaving out estimates of past prints, which never moved stock. */
  stockTotals(): StockTotal[]
  /** Every printer's printing runs over its whole life, and since each part's last replacement on it (see core/maintenance). */
  maintenanceTotals(): MaintenanceTotals
  /** Live recorded events per consumable and unit: what uses, waste, and replacements took since `since`, and when the first was logged. */
  recentStockUse(since: number): RecentStockUse[]
  /** Every print with a charge, its live spend in this currency or unpriced totalled over all time (see core/spend). */
  chargedPrints(currency: PriceCalculatorCurrency): ChargedPrint[]
  /**
   * Marks the transaction's live events undone and returns how many it marked; events a plate's transaction replaced
   * count again, and the plate goes back to unrecorded.
   */
  undoUsageTransaction(transactionId: string, undoneAt: number): number
  /** Every printing use of the prints, undone events included, so a plate can tell which of them it replaced. */
  printingUsage(requestIds: string[]): UsageEvent[]
  listPlates(): Plate[]
  /**
   * Numbers the plate after the workspace's last one. A running plate moves its copies with `moves` and puts its prints
   * on its printer in the same transaction.
   */
  createPlate(plate: NewPlate, moves?: CopyMove[]): Plate
  /** Moves a running plate's copies and sets the stage it runs in, none once the run is over. */
  movePlate(id: string, moves: CopyMove[], stage: PlateRunStage | undefined, at: number): void
  /** Ends every running plate, returning how many there were. */
  endPlateRuns(at: number): number
  /** The newest prints first, at most `MAX_PRINT_JOBS`. */
  listPrintJobs(): PrintJob[]
  /** Adds a print, dropping the oldest beyond `MAX_PRINT_JOBS`. */
  insertPrintJob(job: PrintJob): void
  updatePrintJob(job: PrintJob): void
  /** Undoes the plate's usage, if any, then deletes it; false when there is no such plate. */
  deletePlate(id: string, undoneAt: number): boolean
  /**
   * Replaces the plate's recorded usage in one transaction: undoes what it recorded before, then lets `record` read the
   * prints' printing usage as it stands and append new events, marking the events it replaces undone by it.
   */
  recordPlate(
    id: string,
    at: number,
    record: (
      plate: Plate,
      printing: UsageEvent[],
    ) => { recording: PlateRecording; items: PlateItem[]; events: UsageEvent[]; superseded: string[] },
  ): Plate | undefined
  setRequestCharge(id: string, charged: PrintCharge | null): void
  countUsers(): number
  /** Undefined clears the preference so the browser's languages decide. */
  setUserLocale(userId: string, locale: Locale | undefined): void
  /** Undefined when the user follows the browser or the stored value is no longer a supported language. */
  userLocale(userId: string): Locale | undefined
  countOwnedWorkspaces(userId: string): number
  getUserOnboarding(userId: string, workspaceId?: string): OnboardingProgress
  saveUserOnboarding(userId: string, progress: OnboardingProgress, workspaceId?: string): void
  /** Undefined when the user is not a member of the workspace. */
  notificationPreferences(userId: string): NotificationPreferences | undefined
  setNotificationPreference(userId: string, kind: NotificationKind, enabled: boolean): void
  databaseInfo(): {
    location: { kind: 'local'; path: string; sizeBytes: number } | { kind: 'remote'; display: string }
    integrity: string
    lastCheckedAt: number
  }
  maintain(): { integrity: string; checkedAt: number }
  backup(destination: string): Promise<{ totalPages: number }>
  beginOperation(id: string, payload: OperationPayload): void
  beginUploadOperation(id: string, payload: UploadOperation | AttachOperation): void
  markOperationAssetsMoved(id: string): void
  completeMoveOperation(
    id: string,
    input: { id: string; from: string; to: string; count: number; filePath: string; order?: number; movedAt?: number },
  ): void
  completeDeleteOperation(id: string, requestId: string): void
  completeUploadOperation(id: string, payload: UploadOperation): string
  completeAttachOperation(id: string, payload: AttachOperation): string
  completeRepeatOperation(id: string, payload: RepeatOperation): string
  listOperations(): PendingOperation[]
  finishOperation(id: string): void
  abandonOperation(id: string): void
}

type AsyncRepositoryShape = {
  [Key in keyof RepositoryShape]: RepositoryShape[Key] extends (...args: infer Args) => infer Result
    ? (...args: Args) => Promise<Awaited<Result>>
    : RepositoryShape[Key]
}

export type Repository = Omit<AsyncRepositoryShape, 'getSetting'> & {
  getSetting<T>(key: string): Promise<T | undefined>
  /** Every item of `kind`, archived ones included, in the order they were added. */
  listInventory<Kind extends InventoryKind>(kind: Kind): Promise<InventoryItems[Kind][]>
  /**
   * Stores what `change` makes of the items of `kind` while no other change to them can interleave, so edits to
   * different items never undo each other: new items join the end, changed ones are updated in place, and none may go
   * missing, since only `deleteInventoryItem` removes one. `change` may throw a `Response` to refuse.
   */
  changeInventory<Kind extends InventoryKind>(
    kind: Kind,
    change: (items: InventoryItems[Kind][]) => InventoryItems[Kind][],
  ): Promise<{ previous: InventoryItems[Kind][]; items: InventoryItems[Kind][] }>
  /** What names one item of `kind`; see `InventoryReferences`. */
  inventoryReferences(kind: InventoryKind, id: string): Promise<InventoryReferences>
  /**
   * Deletes one item once `check` accepts it under the same lock as `changeInventory`, unlinking what names it as
   * `InventoryReferences` describes, and returns it with what named it and the items left. `check` may throw a `Response`.
   */
  deleteInventoryItem<Kind extends InventoryKind>(
    kind: Kind,
    id: string,
    check: (item: InventoryItems[Kind] | undefined, references: InventoryReferences) => void,
  ): Promise<{ item: InventoryItems[Kind]; references: InventoryReferences; items: InventoryItems[Kind][] }>
}

// Final print-file storage. Keys are '/'-separated paths from core/assetKeys;
// implementations must honor the operation journal's idempotency contract
// (ensureMoved truth table, idempotent finalizeUpload, retryable purge).
export interface AssetStore {
  initialize(): Promise<void>
  createPath(requestId: string, originalFileName: string): string
  previewPath(originalRelativePath: string): string
  finalizeUpload(stagedPath: string, relativePath: string): Promise<void>
  write(relativePath: string, bytes: Uint8Array): Promise<void>
  writeStream(relativePath: string, stream: ReadableStream, size: number): Promise<void>
  read(relativePath: string): Promise<{ stream: ReadableStream; size: number }>
  stat(relativePath: string): Promise<{ size: number } | undefined>
  remove(relativePath: string): Promise<void>
  removeEmptyDirectory(relativePath: string): Promise<boolean>
  trash(relativePath: string): Promise<string | undefined>
  purgeTrash(trashPath: string): Promise<void>
  ensureMoved(sourcePath: string, destinationPath: string): Promise<void>
  exists(relativePath: string): Promise<boolean>
  trashPath(operationId: string, relativePath: string): string
  sweepTrash(): Promise<void>
  writable(): Promise<void>
  inventory(options?: { maxEntries?: number }): Promise<StorageInventory>
  clear(options?: { initialize?: boolean }): Promise<void>
}

export type StorageInventoryEntry = { path: string; type: 'file' | 'folder'; bytes?: number }
export type StorageInventory = { files: number; folders: number; bytes: number; entries: StorageInventoryEntry[]; truncated: boolean }

export interface UploadStagingArea {
  initialize(): Promise<void>
  assertCapacity(bytes: number): Promise<void>
  uploadPart(uploadId: string): string
  adoptUpload(sourceRef: string, uploadId: string): Promise<void>
  finalizeUpload(uploadId: string, stagedPath: string, destinationPath: string, assets: AssetStore): Promise<void>
  size(filePath: string): Promise<number>
  remove(filePath: string): Promise<void>
  writable(): Promise<void>
}

export interface UploadStore {
  remove(uploadId: string): Promise<void>
}

export type TelemetryConfig = { enabled: boolean }
export type SelfSignupConfig = { enabled: boolean }

export type StorageConfig =
  | { adapter: 'managed' }
  | { adapter: 'local'; root: string }
  | { adapter: 'webdav'; endpoint: string; root: string; username: string; password: string }
  | { adapter: 'dropbox'; root: string; layout?: 'workspace-root-v1' }
  | { adapter: 'google-drive'; root: string; layout?: 'workspace-root-v1' }
  | { adapter: 'onedrive'; root: string; layout?: 'workspace-root-v1' }
  | { adapter: 'box'; root: string; layout?: 'workspace-root-v1' }
  | {
      adapter: 's3'
      endpoint: string
      region: string
      bucket: string
      prefix?: string
      accessKeyId: string
      secretAccessKey: string
      forcePathStyle: boolean
    }

export type StorageMigrationState = 'running' | 'failed' | 'completed' | 'cancelled'
export type StorageMigrationPhase = 'clearing' | 'copying'

export type StorageMigrationFailure = { kind: 'quota' | 'cloudflareUploadLimit' | 'webdavUploadLimit'; path: string; bytes: number }

export type StorageMigration = {
  id: string
  ownerId?: string
  purpose?: 'legacy-namespace' | 'canonical-cloud-root'
  state: StorageMigrationState
  phase?: StorageMigrationPhase
  clearDestination?: boolean
  source: StorageConfig
  destination: StorageConfig
  totalFiles: number
  totalBytes: number
  copiedFiles: number
  copiedBytes: number
  currentPath?: string
  cancelRequestedAt?: number
  error?: string
  /** Set for an expected failure the browser words in the viewer's language; `error` keeps the English for logs and older clients. */
  failure?: StorageMigrationFailure
  startedAt: number
  updatedAt: number
  finishedAt?: number
}

export type PublicStorageMigration = Omit<StorageMigration, 'source' | 'destination'> & {
  source: StorageConfig
  destination: StorageConfig
}

// The stable lifecycle vocabulary. Server-side extensions (notifications,
// webhooks, printer integrations) subscribe to these; additions are fine,
// renames and removals are breaking.
export type AppEvent =
  | 'request.created'
  | 'request.updated'
  | 'request.copiesMoved'
  | 'request.copiesDeleted'
  | 'request.reordered'
  | 'request.archived'
  | 'request.unarchived'
  | 'request.deleted'
  | 'user.created'
  | 'board.changed'
  | 'storage.changed'
  | 'settings.changed'
  | 'workspace.deleted'
  | 'usage.recorded'
  | 'usage.undone'
  | 'inventory.changed'
  | 'inventory.deleted'
  | 'plate.changed'
  | 'print.received'
  | 'spoolman.received'
  | 'spoolman.restocksChanged'

export interface EventBus {
  publish(event: AppEvent): void
}

export interface Notifier {
  /** False when nothing is configured to deliver, so callers can skip gathering recipients. */
  canSend(): Promise<boolean>
  printsReady(recipient: { id: string; email: string; name: string }, prints: { name: string; count: number }[]): Promise<void>
}

export interface Telemetry {
  capture(identity: string, event: string, properties?: Record<string, unknown>): void
  exception(error: unknown, properties?: Record<string, unknown>): void
}
