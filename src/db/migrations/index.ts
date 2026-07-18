import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PrintHubDatabase } from '../connection'

const migrationConfig = {
  migrationsFolder: import.meta.env.PROD
    ? path.join(path.dirname(process.argv[1]), 'drizzle')
    : fileURLToPath(new URL('../../../drizzle', import.meta.url)),
}

export function migrateDatabase(database: PrintHubDatabase, beforeMigrate: () => void) {
  const migrations = readMigrationFiles(migrationConfig)
  const latest = migrations.at(-1)
  const drizzleJournal = database.get<{ found: number }>(
    sql`SELECT 1 found FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`,
  )
  const applied = drizzleJournal
    ? database.get<{ created_at: number }>(sql`SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1`)
    : undefined
  if (latest && (applied?.created_at ?? 0) < latest.folderMillis) beforeMigrate()
  database.run(sql`PRAGMA foreign_keys = OFF`)
  try {
    migrate(database, migrationConfig)
    const violations = database.all(sql`PRAGMA foreign_key_check`)
    if (violations.length > 0) throw new Error('Drizzle migration created foreign key violations')
  } finally {
    database.run(sql`PRAGMA foreign_keys = ON`)
  }
}
