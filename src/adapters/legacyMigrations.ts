import { sql } from 'drizzle-orm'
import type { PrintHubDatabase } from './database'
import initialMigration from './migrations/001_initial.sql?raw'
import operationsMigration from './migrations/002_operations.sql?raw'
import durableUploadsMigration from './migrations/003_uploads_and_reservations.sql?raw'
import settingsMigration from './migrations/004_settings.sql?raw'
import betterAuthMigration from './migrations/005_better_auth.sql?raw'
import assetGenerationMigration from './migrations/006_asset_generation.sql?raw'
import invitesMigration from './migrations/007_invites.sql?raw'
import authRateLimitMigration from './migrations/008_auth_rate_limit.sql?raw'
import adminRoleMigration from './migrations/009_admin_role.sql?raw'
import platePlannerMigration from './migrations/010_plate_planner.sql?raw'
import resinOrientationMigration from './migrations/011_resin_orientation.sql?raw'
import resinOrientationCandidatesMigration from './migrations/012_resin_orientation_candidates.sql?raw'
import orientationAnalysisJobsMigration from './migrations/013_orientation_analysis_jobs.sql?raw'
import assetStageJobsMigration from './migrations/014_asset_stage_jobs.sql?raw'
import resinVolumeMigration from './migrations/015_resin_volume.sql?raw'
import requestPrinterMigration from './migrations/016_request_printer.sql?raw'
import requestPrintTypeMigration from './migrations/017_request_print_type.sql?raw'
import requestPrintTypeCompatibilityMigration from './migrations/018_request_print_type_compatibility.sql?raw'
import twoFactorMigration from './migrations/019_two_factor.sql?raw'
import requestOwnershipMigration from './migrations/020_request_ownership.sql?raw'
import requestOwnerUserMigration from './migrations/021_request_owner_user.sql?raw'

type LegacyTransaction = Parameters<Parameters<PrintHubDatabase['transaction']>[0]>[0]
type LegacyDatabase = PrintHubDatabase | LegacyTransaction
type Migration = { version: number; sql: string; prepare?: (database: LegacyDatabase) => void; foreignKeysOff?: boolean }

const migrations: Migration[] = [
  { version: 1, sql: initialMigration },
  { version: 2, sql: operationsMigration },
  { version: 3, sql: durableUploadsMigration },
  { version: 4, sql: settingsMigration },
  { version: 5, sql: betterAuthMigration },
  { version: 6, sql: assetGenerationMigration },
  { version: 7, sql: invitesMigration },
  { version: 8, sql: authRateLimitMigration },
  { version: 9, sql: adminRoleMigration },
  { version: 10, sql: platePlannerMigration },
  { version: 11, sql: resinOrientationMigration },
  { version: 12, sql: resinOrientationCandidatesMigration },
  { version: 13, sql: orientationAnalysisJobsMigration },
  { version: 14, sql: assetStageJobsMigration },
  { version: 15, sql: resinVolumeMigration },
  { version: 16, sql: requestPrinterMigration },
  { version: 17, sql: requestPrintTypeMigration },
  { version: 18, sql: requestPrintTypeCompatibilityMigration, prepare: prepareRequestPrintTypeCompatibility },
  { version: 19, sql: twoFactorMigration },
  { version: 20, sql: requestOwnershipMigration },
  { version: 21, sql: requestOwnerUserMigration, prepare: prepareRequestOwnerUser, foreignKeysOff: true },
]

function executeSql(database: LegacyDatabase, source: string) {
  for (const statement of source
    .replaceAll(/--.*$/gm, '')
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean))
    database.run(sql.raw(statement))
}

function prepareRequestPrintTypeCompatibility(database: LegacyDatabase) {
  const columns = new Set(database.all<{ name: string }>(sql`PRAGMA table_info(requests)`).map(({ name }) => name))
  if (!columns.has('print_type'))
    database.run(sql.raw("ALTER TABLE requests ADD COLUMN print_type TEXT CHECK (print_type IN ('resin', 'filament'))"))

  if (columns.has('technology')) {
    database.run(
      sql.raw(`UPDATE requests
      SET print_type=CASE technology WHEN 'fdm' THEN 'filament' ELSE 'resin' END
      WHERE print_type IS NULL`),
    )
    database.run(sql.raw('DROP INDEX IF EXISTS requests_technology'))
    database.run(sql.raw('ALTER TABLE requests DROP COLUMN technology'))
  } else {
    database.run(sql.raw("UPDATE requests SET print_type='resin' WHERE printer_id IS NULL AND print_type IS NULL"))
  }

  database.run(sql.raw('UPDATE requests SET print_type=NULL WHERE printer_id IS NOT NULL'))
}

function prepareRequestOwnerUser(database: LegacyDatabase) {
  const unmatched = database.all<{ id: string; requester_email: string }>(
    sql`SELECT id,requester_email
       FROM requests
       WHERE NOT EXISTS (SELECT 1 FROM "user" WHERE email=requests.requester_email COLLATE NOCASE)
       ORDER BY created_at
       LIMIT 10`,
  )
  if (unmatched.length === 0) return
  const requests = unmatched.map(({ id, requester_email }) => `${id} (${requester_email})`).join(', ')
  throw new Error(`cannot migrate request ownership because these requests have no matching account: ${requests}`)
}

export function migrateLegacyDatabase(database: PrintHubDatabase) {
  database.run(sql.raw('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)'))
  const applied = new Set(database.all<{ version: number }>(sql`SELECT version FROM schema_migrations`).map((row) => row.version))
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue
    const apply = () =>
      database.transaction((tx) => {
        migration.prepare?.(tx)
        executeSql(tx, migration.sql)
        if (migration.foreignKeysOff && tx.all(sql`PRAGMA foreign_key_check`).length > 0) {
          throw new Error(`migration ${migration.version} introduced foreign key violations`)
        }
        tx.run(sql`INSERT INTO schema_migrations VALUES (${migration.version},${Date.now()})`)
      })
    if (!migration.foreignKeysOff) {
      apply()
      continue
    }
    database.run(sql`PRAGMA foreign_keys = OFF`)
    try {
      apply()
    } finally {
      database.run(sql`PRAGMA foreign_keys = ON`)
    }
  }
}
