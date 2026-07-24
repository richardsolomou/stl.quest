export type DatabaseHealth = { integrity: string; checkedAt: number }

export interface DatabaseBackend<TDatabase> {
  readonly database: TDatabase
  shared(): DatabaseBackend<TDatabase>
  initialize(): void
  close(): void
  info(): { path: string; sizeBytes: number; integrity: string; lastCheckedAt: number }
  maintain(): DatabaseHealth
  backup(destination: string): Promise<{ totalPages: number; remainingPages: number }>
  isUniqueConstraintError(error: unknown): boolean
}
