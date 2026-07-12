export type Role = 'operator' | 'requester'

export type Identity = {
  id: string
  email: string
  name: string
  role: Role
}

export type Person = { name: string; color?: string }

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
  createdAt: number
  updatedAt: number
}

export type PublicPrintRequest = Omit<PrintRequest, 'fileName' | 'filePath' | 'requesterEmail' | 'thumbnailPath' | 'previewPath'> & {
  mine: boolean
  canEdit: boolean
  canDelete: boolean
  hasPreview: boolean
}

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
  getRequest(id: string): PrintRequest | undefined
  createRequest(request: NewPrintRequest): string
  createUploadSession(uploadId: string, ownerId: string, expiresAt: number, maxIncomplete: number): { fresh: boolean; completedRequestId?: string }
  reserveUpload(uploadId: string, ownerId: string, bytes: number, expiresAt: number, limits: { count: number; bytes: number }): boolean
  expireUploads(now: number): string[]
  activeUploadIds(now: number): Set<string>
  getCompletedUpload(uploadId: string, ownerId: string): string | undefined
  moveCopies(input: { id: string; from: string; to: string; count: number; filePath: string; order?: number }): void
  reorderRequest(id: string, status: string, order: number): void
  updateRequest(id: string, fields: { name?: string; quantity?: number; requesterName?: string; notes?: string; sourceUrl?: string }): void
  deleteRequest(id: string): void
  requestsNeedingAssets(): string[]
  completeAssetGeneration(id: string, generated: { thumbnailPath?: string; previewPath?: string }): void
  listPeople(): Person[]
  listUsers(): Identity[]
  getSetting<T>(key: string): T | undefined
  setSetting(key: string, value: unknown): void
  countUsers(): number
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

export interface EventBus {
  publish(event: AppEvent): void
  subscribe(listener: (event: AppEvent) => void): () => void
}

export interface Telemetry {
  capture(identity: string, event: string, properties?: Record<string, unknown>): Promise<void>
  exception(error: unknown, properties?: Record<string, unknown>): Promise<void>
}
