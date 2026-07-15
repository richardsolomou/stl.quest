import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PrintHubDatabase } from './database'

const migrationConfig = {
  migrationsFolder: import.meta.env.PROD
    ? path.join(path.dirname(process.argv[1]), 'drizzle')
    : fileURLToPath(new URL('./drizzle', import.meta.url)),
}

function seedLegacyBaseline(database: PrintHubDatabase, migrations: ReturnType<typeof readMigrationFiles>) {
  database.run(
    sql.raw(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at numeric
  )`),
  )
  const applied = database.get<{ count: number }>(sql`SELECT count(*) count FROM __drizzle_migrations`)
  if ((applied?.count ?? 0) > 0) return
  const baseline = migrations[0]
  if (!baseline) throw new Error('Drizzle baseline migration is missing')
  database.run(sql`INSERT INTO __drizzle_migrations (hash,created_at) VALUES (${baseline.hash},${baseline.folderMillis})`)
}

export function migrateDatabase(database: PrintHubDatabase, migrateLegacy: () => void, beforeMigrate: () => void) {
  const migrations = readMigrationFiles(migrationConfig)
  const legacy = database.get<{ found: number }>(sql`SELECT 1 found FROM sqlite_master WHERE type='table' AND name='schema_migrations'`)
  const latest = migrations.at(-1)
  const drizzleJournal = database.get<{ found: number }>(
    sql`SELECT 1 found FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`,
  )
  const applied = drizzleJournal
    ? database.get<{ created_at: number }>(sql`SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1`)
    : undefined
  if (legacy || (latest && (applied?.created_at ?? 0) < latest.folderMillis)) beforeMigrate()
  if (legacy) {
    migrateLegacy()
    seedLegacyBaseline(database, migrations)
    database.run(sql`DROP TABLE schema_migrations`)
  }
  migrate(database, migrationConfig)
}
