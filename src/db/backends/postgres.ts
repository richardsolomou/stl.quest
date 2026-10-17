import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { bundledDirectory } from 'ras-stack/database'
import { errorHasCode } from 'ras-stack/server'
import type { DatabaseBackend } from '../backend'
import type { STLQuestDatabase } from '../connection'
import { openPostgreSQL } from '../postgresConnection'

const migrationsFolder = bundledDirectory({
  developmentUrl: new URL('../../../drizzle-postgres', import.meta.url),
  production: import.meta.env?.PROD,
  name: 'drizzle-postgres',
})

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

  async initialize() {
    await migrate(this.connection.drizzle, { migrationsFolder })
    await this.maintain()
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
