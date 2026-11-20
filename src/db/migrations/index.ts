import path from 'node:path'
import { sql } from 'drizzle-orm'
import type { rawDatabase } from '../connection'
import { applySchemaMigrations, schemaMigrations } from './files'

type SQLiteDatabase = ReturnType<typeof rawDatabase>

// Read from the working directory: the repository in development and tests, and `/app` in the image, which copies them from the commit.
const migrationConfig = { migrationsFolder: path.resolve('drizzle') }

/** Applies the pending schema migrations up to the one named `through`, or all of them, calling `beforeMigrate` first when any are pending. */
export function migrateDatabase(database: SQLiteDatabase, beforeMigrate: () => void, through?: string) {
  const migrations = schemaMigrations(migrationConfig.migrationsFolder, through)
  const latest = migrations.at(-1)
  const drizzleJournal = database.get<{ found: number }>(
    sql`SELECT 1 found FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`,
  )
  const applied = drizzleJournal?.found
    ? database.get<{ created_at: number }>(sql`SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1`)
    : undefined
  if (!latest || (applied?.created_at ?? 0) >= latest.folderMillis) return
  beforeMigrate()
  database.run(sql`PRAGMA foreign_keys = OFF`)
  try {
    applySchemaMigrations<void>(database, migrations, migrationConfig.migrationsFolder)
    const violations = database.all(sql`PRAGMA foreign_key_check`)
    if (violations.length > 0) throw new Error('Drizzle migration created foreign key violations')
  } finally {
    database.run(sql`PRAGMA foreign_keys = ON`)
  }
}
