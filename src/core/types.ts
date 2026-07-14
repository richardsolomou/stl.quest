export type Role = 'admin' | 'requester'

export type Identity = {
  id: string
  email: string
  name: string
  image?: string
  role: Role
}

export type Person = { name: string; color?: string }
export type PrintTechnology = 'fdm' | 'sla'
export type PrinterSummary = { id: string; name: string; technology: PrintTechnology }

export type Invite = {
  id: string
  role: Role
  label?: string
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
  requesterEmail: string
  requesterName?: string
  counts: Record<string, number>
  orders: Record<string, number | undefined>
  notes?: string
  sourceUrl?: string
  thumbnailPath?: string
  previewPath?: string
  hasThumbnail: boolean
  printerId?: string
  estimatedResinMl?: number
  createdAt: number
  updatedAt: number
}

export type PublicPrintRequest = Omit<PrintRequest, 'fileName' | 'filePath' | 'requesterEmail' | 'thumbnailPath' | 'previewPath'> & {
  mine: boolean
  canEdit: boolean
  canDelete: boolean
  hasPreview: boolean
  printer?: PrinterSummary
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
  | 'board'
  | 'updated-desc'
  | 'updated-asc'
  | 'created-desc'
  | 'created-asc'
  | 'name-asc'
  | 'name-desc'
  | 'quantity-desc'
  | 'quantity-asc'

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
  sort?: RequestSort
}

export type RequestFacets = {
  requesters: { value: string; label: string; count: number }[]
  total: number
  available: number
}

export type RequestQuery = {
  filters?: RequestFilters
  visibleToEmail?: string
  ownerEmail?: string
  searchPrivateMetadata?: boolean
}

export type RequestQueryResult = { requests: PrintRequest[]; facets: RequestFacets }
export type PublicRequestQueryResult = { requests: PublicPrintRequest[]; facets: RequestFacets }

export type BoardConfig = { privateRequests: boolean }

export type NewPrintRequest = Pick<
  PrintRequest,
  | 'name'
  | 'fileName'
  | 'filePath'
  | 'quantity'
  | 'requesterEmail'
  | 'requesterName'
  | 'notes'
  | 'sourceUrl'
  | 'thumbnailPath'
  | 'previewPath'
  | 'printerId'
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
  getCompletedUpload(uploadId: string, ownerId: string): string | undefined
  moveCopies(input: { id: string; from: string; to: string; count: number; filePath: string; order?: number }): void
  reorderRequest(id: string, status: string, order: number): void
  updateRequest(
    id: string,
    fields: {
      name?: string
      quantity?: number
      requesterName?: string
      notes?: string
      sourceUrl?: string
      printerId?: string | null
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
  requestsNeedingOrientationAnalysis(analysisVersion: number): string[]
  queueOrientationAnalysis(id: string, analysisVersion: number): void
  startOrientationAnalysis(id: string, analysisVersion: number): void
  failOrientationAnalysis(id: string, analysisVersion: number, error: string): void
  listOrientationAnalysisJobs(): import('./platePlanner').OrientationAnalysisJob[]
  getPlateModelAnalysis(requestId: string): import('./platePlanner').PlateModelAnalysis | undefined
  findPlateModelAnalysisByContentHash(contentHash: string, analysisVersion: number): import('./platePlanner').PlateModelAnalysis | undefined
  completeAssetGeneration(id: string, generated: { thumbnailPath?: string; previewPath?: string }): void
  listPlateModelAnalyses(): import('./platePlanner').PlateModelAnalysis[]
  upsertPlateModelAnalyses(analyses: import('./platePlanner').PlateModelAnalysis[]): void
  listPeople(): Person[]
  listUsers(): Identity[]
  createInvite(invite: { id: string; tokenHash: string; role: Role; label?: string; expiresAt: number }): void
  listInvites(): Invite[]
  findInvite(tokenHash: string): Invite | undefined
  claimInvite(tokenHash: string, now: number): Invite | undefined
  completeInvite(id: string, userId: string): void
  deleteInvite(id: string): void
  getSetting<T>(key: string): T | undefined
  setSetting(key: string, value: unknown): void
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
  read(relativePath: string): Promise<{ stream: ReadableStream; size: number }>
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

export type TelemetryConfig = { enabled: boolean }

export type StorageConfig =
  | { adapter: 'local'; root: string }
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
