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

export type Account = Pick<Identity, 'id' | 'email' | 'name' | 'image'> & { role: AccountRole }

export type Person = { id: string; name: string; color?: string }
export type PrinterSummary = {
  id: string
  name: string
  printType: PrintType
  enabled: boolean
}
export type ModelDimensions = { widthMm: number; depthMm: number; heightMm: number }
export type PrinterProfile = PrinterSummary & { presetId?: string; widthMm?: number; depthMm?: number; heightMm?: number }

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
  fileName: string
  filePath: string
  quantity: number
  ownerUserId: string
  ownerEmail: string
  ownerName: string
  counts: Record<string, number>
  orders: Record<string, number | undefined>
  notes?: string
  sourceUrl?: string
  thumbnailPath?: string
  previewPath?: string
  hasThumbnail: boolean
  requestedPrintType?: PrintType
  printerId?: string
  automaticPrinterAssignment?: boolean
  modelDimensions?: ModelDimensions
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
  | 'thumbnailPath'
  | 'previewPath'
  | 'requestedPrintType'
  | 'automaticPrinterAssignment'
  | 'modelDimensions'
> & {
  requesterId: string
  requesterName: string
  mine: boolean
  canEdit: boolean
  canDelete: boolean
  hasPreview: boolean
  printType?: PrintType
  requestedPrintType?: PrintType
  printer?: PrinterSummary
  fitState?: 'pending' | 'selected_printer' | 'another_compatible_printer' | 'none'
}

export type AssetGenerationStage = 'thumbnail' | 'preview'
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

export type BoardSort = RequestSort | 'round-robin'

export type RequestFilters = {
  query?: string
  requester?: string
  minQuantity?: number
  maxQuantity?: number
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
}

export type RequestQueryResult = { requests: PrintRequest[]; facets: RequestFacets }
export type PublicRequestQueryResult = { requests: PublicPrintRequest[]; facets: RequestFacets }

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

export type OperationPayload = MoveOperation | DeleteOperation | UploadOperation
export type PendingOperation = { id: string; state: 'prepared' | 'assets_moved' | 'committed'; payload: OperationPayload }

export interface Repository {
  listRequests(): PrintRequest[]
  queryRequests(query?: RequestQuery): RequestQueryResult
  getRequest(id: string): PrintRequest | undefined
  createRequest(request: NewPrintRequest): string
  createUploadSession(
    uploadId: string,
    ownerId: string,
    expiresAt: number,
    maxIncomplete: number,
  ): { fresh: boolean; completedRequestId?: string }
  reserveUpload(uploadId: string, ownerId: string, bytes: number, expiresAt: number, limits: { count: number; bytes: number }): boolean
  expireUploads(now: number): string[]
  activeUploadIds(now: number): Set<string>
  incompleteUploadStats(now: number): { count: number; bytes: number }
  uploadIdsOwnedBy(ownerId: string): string[]
  deleteUploadSessions(ownerId: string): void
  getCompletedUpload(uploadId: string, ownerId: string): string | undefined
  moveCopies(input: { id: string; from: string; to: string; count: number; filePath: string; order?: number }): void
  reorderRequest(id: string, order: number): void
  updateRequest(
    id: string,
    fields: {
      name?: string
      quantity?: number
      notes?: string
      sourceUrl?: string
      requestedPrintType?: PrintType | null
      printerId?: string | null
      automaticPrinterAssignment?: boolean
    },
  ): void
  deleteRequest(id: string): void
  requestsNeedingAssets(): string[]
  queueAssetGeneration(id: string): void
  requeueAssetGeneration(id: string, stages: AssetGenerationStage[]): void
  startAssetGeneration(id: string, stages: AssetGenerationStage[]): void
  finishAssetGeneration(
    id: string,
    stage: AssetGenerationStage,
    outcome: { status: 'ready' | 'skipped' | 'failed'; path?: string; error?: string },
  ): void
  listAssetGenerationJobs(): AssetGenerationJob[]
  assetGenerationJobs(id: string): AssetGenerationJob[]
  requeueInterruptedAssetGeneration(): void
  requestsNeedingModelDimensions(): string[]
  setModelDimensions(id: string, dimensions: ModelDimensions): void
  completeAssetGeneration(id: string, generated: { thumbnailPath?: string; previewPath?: string }): void
  listPeople(): Person[]
  listUsers(): Identity[]
  listAccounts(): Account[]
  accountExists(email: string): boolean
  isSuperAdminWorkspace(): boolean
  createInvite(invite: { id: string; tokenHash: string; role: Role; label?: string; recipientEmail?: string; expiresAt: number }): void
  listInvites(): Invite[]
  findInvite(tokenHash: string): Invite | undefined
  claimInvite(tokenHash: string, now: number): Invite | undefined
  completeInvite(id: string, userId: string): void
  deleteInvite(id: string): void
  getSetting<T>(key: string): T | undefined
  setSetting(key: string, value: unknown): void
  setSettings(values: Record<string, unknown>): void
  deleteSetting(key: string): void
  replacePrinterProfiles(profiles: PrinterProfile[]): void
  countUsers(): number
  databaseInfo(): { path: string; sizeBytes: number; integrity: string; lastCheckedAt: number }
  maintain(): { integrity: string; checkedAt: number }
  backup(destination: string): Promise<{ totalPages: number; remainingPages: number }>
  beginOperation(id: string, payload: OperationPayload): void
  beginUploadOperation(id: string, payload: UploadOperation): void
  markOperationAssetsMoved(id: string): void
  completeMoveOperation(id: string, input: { id: string; from: string; to: string; count: number; filePath: string; order?: number }): void
  completeDeleteOperation(id: string, requestId: string): void
  completeUploadOperation(id: string, payload: UploadOperation): string
  listOperations(): PendingOperation[]
  finishOperation(id: string): void
  abandonOperation(id: string): void
}

// Final print-file storage. Keys are '/'-separated paths from core/assetKeys;
// implementations must honor the operation journal's idempotency contract
// (ensureMoved truth table, idempotent finalizeUpload, retryable purge).
export interface AssetStore {
  initialize(): Promise<void>
  createPath(originalFileName: string): string
  previewPath(originalRelativePath: string): string
  finalizeUpload(stagedPath: string, relativePath: string): Promise<void>
  write(relativePath: string, bytes: Uint8Array): Promise<void>
  writeStream(relativePath: string, stream: ReadableStream, size: number): Promise<void>
  read(relativePath: string): Promise<{ stream: ReadableStream; size: number }>
  stat(relativePath: string): Promise<{ size: number } | undefined>
  move(relativePath: string, statusId: string): Promise<string>
  remove(relativePath: string): Promise<void>
  trash(relativePath: string): Promise<string | undefined>
  purgeTrash(trashPath: string): Promise<void>
  destinationPath(relativePath: string, statusId: string): string
  ensureMoved(sourcePath: string, destinationPath: string): Promise<void>
  exists(relativePath: string): Promise<boolean>
  trashPath(operationId: string, relativePath: string): string
  sweepTrash(): Promise<void>
  writable(): Promise<void>
}

// Local-disk staging for in-flight chunked uploads; always filesystem-backed.
export interface UploadStagingArea {
  initialize(): Promise<void>
  uploadPart(uploadId: string): string
  writeUploadPart(filePath: string, bytes: Uint8Array): Promise<void>
  copyUploadPart(sourcePath: string, filePath: string): Promise<void>
  size(filePath: string): Promise<number>
  remove(filePath: string): Promise<void>
  sweepUploads(exclude?: ReadonlySet<string>): Promise<void>
  writable(): Promise<void>
}

export interface UploadStore {
  remove(uploadId: string): Promise<void>
}

export type TelemetryConfig = { enabled: boolean }

export type StorageConfig =
  | { adapter: 'local'; root: string }
  | { adapter: 'webdav'; endpoint: string; root: string; username: string; password: string }
  | { adapter: 'dropbox'; root: string }
  | { adapter: 'google-drive'; root: string }
  | { adapter: 'onedrive'; root: string }
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

export type StorageMigration = {
  id: string
  state: StorageMigrationState
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
  | 'request.reordered'
  | 'request.deleted'
  | 'user.created'
  | 'board.changed'
  | 'settings.changed'

export interface EventBus {
  publish(event: AppEvent): void
  subscribe(listener: (event: AppEvent) => void): () => void
}

export interface Telemetry {
  capture(identity: string, event: string, properties?: Record<string, unknown>): Promise<void>
  exception(error: unknown, properties?: Record<string, unknown>): Promise<void>
}
