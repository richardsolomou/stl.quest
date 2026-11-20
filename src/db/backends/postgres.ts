import path from 'node:path'
import { sql } from 'drizzle-orm'
import type { DatabaseBackend } from '../backend'
import { runMigrations } from '../dataMigrations'
import type { MigrationLog } from '../dataMigrations/types'
import { applySchemaMigrations, schemaMigrations } from '../migrations/files'
import type { STLQuestDatabase } from '../connection'
import { errorHasCode } from '../errors'
import { openPostgreSQL } from '../postgresConnection'

// Read from the working directory: the repository in development and tests, and `/app` in the image, which copies them from the commit.
const migrationsFolder = path.resolve('drizzle-postgres')

export class PostgreSQLBackend implements DatabaseBackend<STLQuestDatabase> {
  private lastHealth = { integrity: 'unknown', checkedAt: 0 }
  private readonly connection

  private constructor(
    readonly database: STLQuestDatabase,
    private readonly url: string,
    connection: ReturnType<typeof openPostgreSQL>,
    private readonly ownsDatabase = true,
  ) {
    this.connection = connection
  }

  static open(url: string) {
    const connection = openPostgreSQL(url)
    return new PostgreSQLBackend(connection.database, url, connection)
  }

  shared() {
    return new PostgreSQLBackend(this.database, this.url, this.connection, false)
  }

  async initialize(log: MigrationLog) {
    await runMigrations(this, this.database, log)
    await this.maintain()
  }

  async migrateSchema(through?: string) {
    await applySchemaMigrations<Promise<void>>(this.connection.drizzle, schemaMigrations(migrationsFolder, through), migrationsFolder)
  }

  async close() {
    if (this.ownsDatabase) await this.connection.client.end({ timeout: 5 })
  }

  info() {
    const parsed = new URL(this.url)
    parsed.username = ''
    parsed.password = ''
    return {
      location: { kind: 'remote' as const, display: parsed.toString() },
      integrity: this.lastHealth.integrity,
      lastCheckedAt: this.lastHealth.checkedAt,
    }
  }

  async maintain() {
    await this.database.get(sql`SELECT 1`)
    this.lastHealth = { integrity: 'ok', checkedAt: Date.now() }
    return this.lastHealth
  }

  isUniqueConstraintError(error: unknown) {
    return errorHasCode(error, '23505')
  }
}
