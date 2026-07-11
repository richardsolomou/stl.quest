export type Role = 'operator' | 'requester'

export type Identity = {
  id: string
  email: string
  name: string
  role: Role
}

export type Person = { name: string; color?: string }

export type Job = {
  _id: string
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
  thumbnail?: string
  previewPath?: string
  hasThumbnail: boolean
  createdAt: number
  updatedAt: number
}

export type PublicJob = Omit<Job, 'fileName' | 'filePath' | 'requesterEmail' | 'thumbnail' | 'previewPath'> & {
  canEdit: boolean
  hasPreview: boolean
}

export type NewJob = Pick<
  Job,
  | 'name'
  | 'fileName'
  | 'filePath'
  | 'quantity'
  | 'requesterEmail'
  | 'requesterName'
  | 'notes'
  | 'sourceUrl'
  | 'thumbnail'
  | 'previewPath'
>

export type MoveOperation = {
  kind: 'move'
  jobId: string
  fromStatus: string
  toStatus: string
  count: number
  order?: number
  sourcePath: string
  destinationPath: string
}

export type DeleteOperation = {
  kind: 'delete'
  jobId: string
  assets: { originalPath: string; trashPath: string }[]
}

export type UploadOperation = {
  kind: 'upload'
  uploadId: string
  ownerId: string
  jobId: string
  partPath: string
  destinationPath: string
  previewPartPath?: string
  previewDestinationPath?: string
  job: Omit<NewJob, 'filePath' | 'previewPath'>
}

export type OperationPayload = MoveOperation | DeleteOperation | UploadOperation
export type PendingOperation = { id: string; state: 'prepared' | 'assets_moved' | 'committed'; payload: OperationPayload }

export interface Repository {
  listJobs(): Job[]
  getJob(id: string): Job | undefined
  createJob(job: NewJob): string
  createUploadSession(uploadId: string, ownerId: string, expiresAt: number, maxIncomplete: number): { fresh: boolean; completedJobId?: string }
  reserveUpload(uploadId: string, ownerId: string, bytes: number, expiresAt: number, limits: { count: number; bytes: number }): boolean
  expireUploads(now: number): string[]
  activeUploadIds(now: number): Set<string>
  getCompletedUpload(uploadId: string, ownerId: string): string | undefined
  moveCopies(input: { id: string; from: string; to: string; count: number; filePath: string; order?: number }): void
  reorderJob(id: string, status: string, order: number): void
  updateJob(id: string, fields: { name?: string; quantity?: number; requesterName?: string; notes?: string; sourceUrl?: string }): void
  deleteJob(id: string): void
  listPeople(): Person[]
  findUserByEmail(email: string): Identity | undefined
  countUsers(): number
  createUser(input: { email: string; name: string; passwordHash?: string; role: Role }): Identity
  createFirstUser(input: { email: string; name: string; passwordHash: string }): Identity
  passwordHash(userId: string): string | undefined
  createSession(input: { tokenHash: string; userId: string; expiresAt: number }): void
  createSessionIfPasswordHash(input: { tokenHash: string; userId: string; expiresAt: number; expectedPasswordHash: string }): boolean
  findSession(tokenHash: string): Identity | undefined
  deleteSession(tokenHash: string): void
  updatePassword(userId: string, passwordHash: string): void
  rotatePasswordSession(input: { userId: string; expectedPasswordHash: string; passwordHash: string; tokenHash: string; expiresAt: number }): boolean
  beginOperation(id: string, payload: OperationPayload): void
  beginUploadOperation(id: string, payload: UploadOperation): void
  markOperationAssetsMoved(id: string): void
  completeMoveOperation(id: string, input: { id: string; from: string; to: string; count: number; filePath: string; order?: number }): void
  completeDeleteOperation(id: string, jobId: string): void
  completeUploadOperation(id: string, payload: UploadOperation): string
  listOperations(): PendingOperation[]
  finishOperation(id: string): void
  abandonOperation(id: string): void
}

export interface AssetStore {
  initialize(): Promise<void>
  absolute(relativePath: string): string
  createPath(originalFileName: string): string
  previewPath(originalRelativePath: string): string
  finalizeUpload(partPath: string, relativePath: string): Promise<void>
  write(relativePath: string, bytes: Uint8Array): Promise<void>
  move(relativePath: string, statusId: string): Promise<string>
  remove(relativePath: string): Promise<void>
  trash(relativePath: string): Promise<string | undefined>
  purgeTrash(trashPath: string): Promise<void>
  uploadPart(uploadId: string): string
  uploadPreviewPart(uploadId: string): string
  writeUploadPart(filePath: string, bytes: Uint8Array): Promise<void>
  sweepUploads(exclude?: ReadonlySet<string>): Promise<void>
  destinationPath(relativePath: string, statusId: string): string
  ensureMoved(sourcePath: string, destinationPath: string): Promise<void>
  exists(relativePath: string): Promise<boolean>
  trashPath(operationId: string, relativePath: string): string
  sweepTrash(): Promise<void>
  writable(): Promise<void>
}

export interface EventBus {
  publish(event: string): void
  subscribe(listener: (event: string) => void): () => void
}

export interface Telemetry {
  capture(identity: string, event: string, properties?: Record<string, unknown>): Promise<void>
  exception(error: unknown, properties?: Record<string, unknown>): Promise<void>
}
