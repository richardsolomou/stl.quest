import type { StoragePlan } from './plans'
import type { OnboardingProgress } from './onboarding'

export type Role = 'admin' | 'requester'
export type AccountRole = 'super_admin' | 'requester'
export type WorkspaceRole = 'owner' | 'admin' | 'member'
export type PrintType = 'resin' | 'filament'

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
  archived?: boolean
  used?: boolean
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
  createdAt: number
  updatedAt: number
}

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
export type AssetGenerationJob = {
  requestId: string
  stage: AssetGenerationStage
  status: 'pending' | 'running' | 'ready' | 'skipped' | 'failed'
  error?: string
  queuedAt: number
  startedAt?: number
  finishedAt?: number
}

export type RequestSort =
  | 'fair'
  | 'updated-desc'
  | 'updated-asc'
  | 'created-desc'
  | 'created-asc'
  | 'name-asc'
  | 'name-desc'
  | 'quantity-desc'
  | 'quantity-asc'
  | 'material-desc'
  | 'material-asc'
  | 'time-desc'
  | 'time-asc'
  | 'archived-desc'
  | 'archived-asc'

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

export type BoardConfig = {
  privateRequests: boolean
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
  renameGroup(id: string, name: string): void
  updateGroup(id: string, fields: { name?: string; color?: PrintGroupColor; parentId?: string | null }): void
  tagCopies(groupId: string, status: string, items: { requestId: string; count: number }[]): void
  untagCopies(groupId: string, status: string, requestIds: string[]): void
  deleteGroup(id: string): void
  reorderGroupItem(groupId: string, status: string, requestId: string, targetRequestId: string, edge: 'before' | 'after'): void
  moveGroupItem(requestId: string, count: number, status: string, fromGroupId?: string, toGroupId?: string): void
  moveGroupItemAcrossStatus(
    requestId: string,
    count: number,
    from: string,
    to: string,
    fromGroupId: string | undefined,
    toGroupId: string | undefined,
    filePath: string | undefined,
    movedAt: number,
  ): void
  moveGroup(
    id: string,
    from: string,
    to: string,
    inputs: { id: string; from: string; to: string; count: number; filePath?: string; movedAt?: number }[],
  ): void
  createRequest(request: NewPrintRequest): string
  createUploadSession(
    uploadId: string,
    ownerId: string,
    expiresAt: number,
    maxIncomplete: number,
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
  deleteUploadSessions(ownerId: string): void
  getCompletedUpload(uploadId: string, ownerId: string): string | undefined
  updateRequestFilePath(id: string, previousPath: string, nextPath: string): boolean
  moveCopies(input: { id: string; from: string; to: string; count: number; filePath?: string; order?: number; movedAt?: number }): void
  moveCopiesBatch(
    inputs: { id: string; from: string; to: string; count: number; filePath?: string; order?: number; movedAt?: number }[],
  ): void
  reorderRequest(id: string, order: number): void
  updateRequest(
    id: string,
    fields: {
      name?: string
      quantity?: number
      notes?: string
      sourceUrl?: string
      sourceImageUrl?: string | null
      requestedPrintType?: PrintType | null
      printerId?: string | null
      automaticPrinterAssignment?: boolean
      estimatedMaterialOverride?: number | null
      estimatedPrintMinutesOverride?: number | null
    },
  ): void
  deleteRequest(id: string): void
  setRequestsArchived(ids: string[], archivedAt: number | null): void
  deleteCopiesBatch(inputs: { id: string; status: string; count: number; groupId?: string; deleteRequest: boolean }[]): void
  requestsNeedingAssets(): string[]
  assetGenerationCandidates(afterId: string | undefined, limit: number): string[]
  queueAssetGeneration(id: string): void
  requeueAssetGeneration(id: string, stages: AssetGenerationStage[]): void
  startAssetGeneration(id: string, stages: AssetGenerationStage[]): void
  finishAssetGeneration(
    id: string,
    stage: AssetGenerationStage,
    outcome: { status: 'ready' | 'skipped' | 'failed'; path?: string; error?: string },
  ): void
  listAssetGenerationJobs(stage?: AssetGenerationStage): AssetGenerationJob[]
  assetGenerationJobs(id: string): AssetGenerationJob[]
  requeueInterruptedAssetGeneration(): void
  requestsNeedingModelDimensions(): string[]
  setModelDimensions(id: string, dimensions: ModelDimensions, volumeMm3?: number, surfaceAreaMm2?: number): void
  completeAssetGeneration(id: string, generated: { thumbnailPath?: string; previewPath?: string }): void
  recordSourceImagePath(id: string, path: string | null): void
  listPeople(): Person[]
  listUsers(): Identity[]
  listAccounts(): Account[]
  accountExists(email: string): boolean
  createInvite(invite: { id: string; tokenHash: string; role: Role; label?: string; recipientEmail?: string; expiresAt: number }): void
  listInvites(): Invite[]
  findInvite(tokenHash: string): Invite | undefined
  claimInvite(tokenHash: string, now: number): Invite | undefined
  completeInvite(id: string, userId: string): void
  deleteInvite(id: string): void
  getSetting<T>(key: string): T | undefined
  listAssetMigrations(): string[]
  recordAssetMigration(id: string): void
  setSetting(key: string, value: unknown): void
  setSettings(values: Record<string, unknown>, deleteKeys?: string[]): void
  setSettingsAndReleaseManagedStorage(values: Record<string, unknown>, deleteKeys?: string[]): void
  deleteSetting(key: string): void
  replacePrinterProfiles(profiles: PrinterProfile[]): void
  countUsers(): number
  countOwnedWorkspaces(userId: string): number
  getUserOnboarding(userId: string, workspaceId?: string): OnboardingProgress
  saveUserOnboarding(userId: string, progress: OnboardingProgress, workspaceId?: string): void
  databaseInfo(): {
    location: { kind: 'local'; path: string; sizeBytes: number } | { kind: 'remote'; display: string }
    integrity: string
    lastCheckedAt: number
  }
  maintain(): { integrity: string; checkedAt: number }
  backup(destination: string): Promise<{ totalPages: number; remainingPages: number }>
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

export interface EventBus {
  publish(event: AppEvent): void
}

export interface Telemetry {
  capture(identity: string, event: string, properties?: Record<string, unknown>): Promise<void>
  exception(error: unknown, properties?: Record<string, unknown>): Promise<void>
}
