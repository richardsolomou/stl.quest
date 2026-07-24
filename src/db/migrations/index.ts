import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { STLQuestDatabase } from '../connection'

const migrationConfig = {
  migrationsFolder: import.meta.env.PROD
    ? path.join(path.dirname(process.argv[1]), 'drizzle')
    : fileURLToPath(new URL('../../../drizzle', import.meta.url)),
}

export async function migrateDatabase(database: STLQuestDatabase, beforeMigrate: () => Promise<void>) {
  const migrations = readMigrationFiles(migrationConfig)
  const latest = migrations.at(-1)
  const drizzleJournal = await database.get<{ found: number }>(
    sql`SELECT count(*) found FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`,
  )
  const applied = drizzleJournal?.found
    ? await database.get<{ created_at: number }>(sql`SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1`)
    : undefined
  if (latest && (applied?.created_at ?? 0) < latest.folderMillis) await beforeMigrate()
  await database.run(sql`PRAGMA foreign_keys = OFF`)
  try {
    await migrate(database, migrationConfig)
    const violations = await database.all(sql`PRAGMA foreign_key_check`)
    if (violations.length > 0) throw new Error('Drizzle migration created foreign key violations')
  } finally {
    await database.run(sql`PRAGMA foreign_keys = ON`)
  }
}
