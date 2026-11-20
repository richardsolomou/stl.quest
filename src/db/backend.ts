import type { MigrationLog } from './dataMigrations/types'

export type DatabaseHealth = { integrity: string; checkedAt: number }
export type DatabaseInfo = {
  location: { kind: 'local'; path: string; sizeBytes: number } | { kind: 'remote'; display: string }
  integrity: string
  lastCheckedAt: number
}
export type DatabaseBackupResult = { totalPages: number }

export interface DatabaseBackend<TDatabase> {
  readonly database: TDatabase
  shared(): DatabaseBackend<TDatabase>
  /** Applies every pending schema and data migration, then checks the database's health. */
  initialize(log: MigrationLog): Promise<void>
  /** Applies pending schema migrations up to the one named `through`, or all of them. */
  migrateSchema(through?: string): Promise<void>
  close(): void | Promise<void>
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
