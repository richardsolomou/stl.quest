export type DatabaseHealth = { integrity: string; checkedAt: number }
export type DatabaseInfo = {
  location: { kind: 'local'; path: string; sizeBytes: number } | { kind: 'remote'; display: string }
  integrity: string
  lastCheckedAt: number
}
export type DatabaseBackupResult = { totalPages: number; remainingPages: number }

export interface DatabaseBackend<TDatabase> {
  readonly database: TDatabase
  shared(): DatabaseBackend<TDatabase>
  initialize(): Promise<void>
  close(): void
  info(): DatabaseInfo
  maintain(): Promise<DatabaseHealth>
  isUniqueConstraintError(error: unknown): boolean
}

export interface DatabaseBackupCapability {
  backup(destination: string): Promise<DatabaseBackupResult>
}

export function supportsDatabaseBackup(backend: DatabaseBackend<unknown>): backend is DatabaseBackend<unknown> & DatabaseBackupCapability {
  return 'backup' in backend && typeof backend.backup === 'function'
}
