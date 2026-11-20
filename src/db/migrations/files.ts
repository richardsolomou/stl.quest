import fs from 'node:fs'
import path from 'node:path'
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator'

/**
 * The generated schema migrations in `folder`, in journal order, ending with the one named `through` (its tag without
 * the number, such as `inventory` for `0036_inventory`) when given, so a data migration can run between two of them.
 */
export function schemaMigrations(folder: string, through?: string): MigrationMeta[] {
  const migrations = readMigrationFiles({ migrationsFolder: folder })
  if (through === undefined) return migrations
  const { entries } = JSON.parse(fs.readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
  const matches = entries.flatMap(({ tag }, index) => (tag.replace(/^\d+_/, '') === through ? [index] : []))
  if (matches.length !== 1) throw new Error(`expected one schema migration named ${through} in ${folder}, found ${matches.length}`)
  return migrations.slice(0, matches[0] + 1)
}

/**
 * Applies `migrations` the way drizzle's `migrate()` applies a whole folder, through the same dialect method it calls,
 * which has no public form that takes a list; drizzle-orm is pinned, so this cannot change underneath.
 */
export function applySchemaMigrations<Result>(database: object, migrations: MigrationMeta[], folder: string): Result {
  const { dialect, session } = database as {
    dialect: { migrate(migrations: MigrationMeta[], session: unknown, config: { migrationsFolder: string }): Result }
    session: unknown
  }
  return dialect.migrate(migrations, session, { migrationsFolder: folder })
}
