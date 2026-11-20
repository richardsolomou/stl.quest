import { eq } from 'drizzle-orm'
import type { STLQuestDatabase } from '../connection'
import { dataMigrations as appliedDataMigrations } from '../schema'
import { legacyCostingMigration } from './0001LegacyCosting'
import { inventoryTablesMigration } from './0002InventoryTables'
import { markupPercentMigration } from './0003MarkupPercent'
import type { DataMigration, MigrationLog, SchemaMigrator } from './types'

export const dataMigrations: readonly DataMigration[] = [legacyCostingMigration, inventoryTablesMigration, markupPercentMigration]

/**
 * Brings the database up to date: each pending data migration runs in its own transaction, together with the record
 * that it ran, once the schema reaches the migration it follows; then the remaining schema migrations apply. A failure
 * rolls its migration back and stops the rest, so the next start retries from there.
 */
export async function runMigrations(
  schema: SchemaMigrator,
  database: STLQuestDatabase,
  log: MigrationLog,
  migrations: readonly DataMigration[] = dataMigrations,
) {
  validateRegistry(migrations)
  for (const migration of migrations) {
    await schema.migrateSchema(migration.after)
    const applied = await database
      .select({ id: appliedDataMigrations.id })
      .from(appliedDataMigrations)
      .where(eq(appliedDataMigrations.id, migration.id))
      .get()
    if (applied) continue
    await database.transaction(async (tx) => {
      await migration.run(tx, log)
      await tx.insert(appliedDataMigrations).values({ id: migration.id, appliedAt: Date.now() }).run()
    })
    log.info({ event: 'data_migration_completed', migration_id: migration.id }, 'data migration completed')
  }
  await schema.migrateSchema()
}

function validateRegistry(migrations: readonly DataMigration[]) {
  const ids = migrations.map((migration) => migration.id)
  if (ids.some((id) => !/^\d{4}_[a-z0-9_]+$/.test(id))) throw new Error('data migration ids must use the 0001_name format')
  if (new Set(ids).size !== ids.length) throw new Error('data migration ids must be unique')
  if (ids.some((id, index) => index > 0 && id <= ids[index - 1])) throw new Error('data migrations must be appended in order')
}
