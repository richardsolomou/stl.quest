import { sql } from 'drizzle-orm'
import type { DatabaseBackend } from '../backend'
import { closeDatabase, createDatabase, type STLQuestDatabase } from '../connection'
import { migrateDatabase } from '../migrations'

export class LibSQLBackend implements DatabaseBackend<STLQuestDatabase> {
  private lastHealth = { integrity: 'unknown', checkedAt: 0 }

  constructor(
    readonly database: STLQuestDatabase,
    private readonly url: string,
    private readonly ownsDatabase = true,
  ) {}

  static open(url: string, authToken?: string) {
    return new LibSQLBackend(createDatabase({ url, authToken }), url)
  }

  shared() {
    return new LibSQLBackend(this.database, this.url, false)
  }

  async initialize() {
    await migrateDatabase(this.database, async () => undefined)
    await this.maintain()
  }

  close() {
    if (this.ownsDatabase) closeDatabase(this.database)
  }

  info() {
    return {
      path: this.url,
      sizeBytes: 0,
      integrity: this.lastHealth.integrity,
      lastCheckedAt: this.lastHealth.checkedAt,
    }
  }

  async maintain() {
    await this.database.get(sql`SELECT 1`)
    this.lastHealth = { integrity: 'ok', checkedAt: Date.now() }
    return this.lastHealth
  }

  async backup(_destination: string): Promise<{ totalPages: number; remainingPages: number }> {
    throw new Error('local database backups are unavailable for a remote libSQL database; configure backups with the database provider')
  }

  isUniqueConstraintError(error: unknown) {
    let current = error
    while (current && typeof current === 'object') {
      if ('code' in current && (current.code === 'SQLITE_CONSTRAINT_UNIQUE' || current.code === 'SQLITE_CONSTRAINT')) return true
      current = 'cause' in current ? current.cause : undefined
    }
    return false
  }
}
