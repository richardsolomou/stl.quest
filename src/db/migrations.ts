import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PrintHubDatabase } from '.'

const migrationConfig = {
  migrationsFolder: import.meta.env.PROD
    ? path.join(path.dirname(process.argv[1]), 'drizzle')
    : fileURLToPath(new URL('../../drizzle', import.meta.url)),
}

type DatabaseTransaction = Parameters<Parameters<PrintHubDatabase['transaction']>[0]>[0]
type DatabaseExecutor = PrintHubDatabase | DatabaseTransaction

function seedBaseline(database: DatabaseExecutor, migrations: ReturnType<typeof readMigrationFiles>) {
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

function validatePreDrizzleJournal(database: PrintHubDatabase) {
  const versions = database
    .all<{ version: number }>(sql`SELECT version FROM schema_migrations ORDER BY version`)
    .map(({ version }) => version)
  const latest = versions.at(-1) ?? 0
  const contiguous = versions.every((version, index) => version === index + 1)
  if (!contiguous || latest < 18 || latest > 21) {
    throw new Error(`pre-Drizzle database must be on schema version 18 through 21 (found version ${latest})`)
  }
  return latest
}

function addTwoFactorSchema(database: DatabaseExecutor) {
  const userColumns = database.all<{ name: string }>(sql`PRAGMA table_info("user")`)
  if (!userColumns.some(({ name }) => name === 'twoFactorEnabled')) {
    database.run(sql.raw('ALTER TABLE "user" ADD COLUMN "twoFactorEnabled" integer NOT NULL DEFAULT 0'))
  }
  database.run(
    sql.raw(`CREATE TABLE IF NOT EXISTS "twoFactor" (
      "id" text PRIMARY KEY NOT NULL,
      "secret" text NOT NULL,
      "backupCodes" text NOT NULL,
      "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
      "verified" integer NOT NULL DEFAULT 1,
      "failedVerificationCount" integer NOT NULL DEFAULT 0,
      "lockedUntil" text
    )`),
  )
  database.run(sql.raw('CREATE INDEX IF NOT EXISTS "twoFactor_secret_idx" ON "twoFactor" ("secret")'))
  database.run(sql.raw('CREATE INDEX IF NOT EXISTS "twoFactor_userId_idx" ON "twoFactor" ("userId")'))
}

function transferRequestOwnership(database: DatabaseExecutor) {
  database.run(
    sql.raw(`UPDATE requests
    SET
      requester_email = (
        SELECT email FROM "user"
        WHERE trim(name) = trim(requests.requester_name) COLLATE NOCASE
        LIMIT 1
      ),
      requester_name = (
        SELECT name FROM "user"
        WHERE trim(name) = trim(requests.requester_name) COLLATE NOCASE
        LIMIT 1
      )
    WHERE trim(coalesce(requester_name, '')) <> ''
      AND (
        SELECT count(*) FROM "user"
        WHERE trim(name) = trim(requests.requester_name) COLLATE NOCASE
      ) = 1`),
  )
  database.run(
    sql.raw(`UPDATE requests
    SET requester_name = (
      SELECT name FROM "user"
      WHERE email = requests.requester_email COLLATE NOCASE
      LIMIT 1
    )
    WHERE EXISTS (
      SELECT 1 FROM "user"
      WHERE email = requests.requester_email COLLATE NOCASE
    )`),
  )
  const unmatched = database.all<{ id: string; requester_email: string }>(
    sql`SELECT id,requester_email
        FROM requests
        WHERE NOT EXISTS (SELECT 1 FROM "user" WHERE email=requests.requester_email COLLATE NOCASE)
        ORDER BY created_at
        LIMIT 10`,
  )
  if (unmatched.length > 0) {
    const requests = unmatched.map(({ id, requester_email }) => `${id} (${requester_email})`).join(', ')
    throw new Error(`cannot migrate request ownership because these requests have no matching account: ${requests}`)
  }

  for (const statement of [
    `CREATE TABLE requests_with_owner (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      owner_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
      requester_email TEXT NOT NULL,
      requester_name TEXT,
      notes TEXT,
      source_url TEXT,
      thumbnail_path TEXT,
      preview_path TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      assets_generated_at INTEGER,
      printer_id TEXT,
      print_type TEXT CHECK (print_type IN ('resin', 'filament'))
    )`,
    `INSERT INTO requests_with_owner (
      id, name, file_name, file_path, quantity, owner_user_id, requester_email, requester_name,
      notes, source_url, thumbnail_path, preview_path, created_at, updated_at, assets_generated_at,
      printer_id, print_type
    )
    SELECT
      requests.id, requests.name, requests.file_name, requests.file_path, requests.quantity,
      (SELECT id FROM "user" WHERE email = requests.requester_email COLLATE NOCASE),
      requests.requester_email, requests.requester_name, requests.notes, requests.source_url,
      requests.thumbnail_path, requests.preview_path, requests.created_at, requests.updated_at,
      requests.assets_generated_at, requests.printer_id, requests.print_type
    FROM requests`,
    'DROP TABLE requests',
    'ALTER TABLE requests_with_owner RENAME TO requests',
    'CREATE INDEX requests_created ON requests(created_at DESC)',
    'CREATE INDEX requests_print_type ON requests(print_type)',
    'CREATE INDEX requests_printer_id ON requests(printer_id)',
    'CREATE INDEX requests_owner_user_id ON requests(owner_user_id)',
    `CREATE TABLE upload_sessions_with_owner (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
      bytes INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL,
      completed_request_id TEXT REFERENCES requests(id) ON DELETE CASCADE
    )`,
    `INSERT INTO upload_sessions_with_owner (id, owner_id, bytes, expires_at, completed_request_id)
    SELECT sessions.id, sessions.owner_id, sessions.bytes, sessions.expires_at, sessions.completed_request_id
    FROM upload_sessions sessions
    JOIN "user" owner ON owner.id=sessions.owner_id
    WHERE sessions.completed_request_id IS NULL
       OR EXISTS (SELECT 1 FROM requests WHERE requests.id=sessions.completed_request_id)`,
    'DROP TABLE upload_sessions',
    'ALTER TABLE upload_sessions_with_owner RENAME TO upload_sessions',
    'CREATE INDEX upload_sessions_owner ON upload_sessions(owner_id, expires_at)',
  ])
    database.run(sql.raw(statement))
}

function bootstrapPreDrizzleDatabase(database: PrintHubDatabase, migrations: ReturnType<typeof readMigrationFiles>) {
  const version = validatePreDrizzleJournal(database)
  const requestColumns = database.all<{ name: string }>(sql`PRAGMA table_info(requests)`)
  const ownsRequests = requestColumns.some(({ name }) => name === 'owner_user_id')
  database.run(sql`PRAGMA foreign_keys = OFF`)
  try {
    database.transaction((tx) => {
      if (version === 18) addTwoFactorSchema(tx)
      if (!ownsRequests) transferRequestOwnership(tx)
      seedBaseline(tx, migrations)
      tx.run(sql`DROP TABLE schema_migrations`)
      const violations = tx.all(sql`PRAGMA foreign_key_check`)
      if (violations.length > 0) throw new Error('pre-Drizzle database contains foreign key violations')
    })
  } finally {
    database.run(sql`PRAGMA foreign_keys = ON`)
  }
}

export function migrateDatabase(database: PrintHubDatabase, beforeMigrate: () => void) {
  const migrations = readMigrationFiles(migrationConfig)
  const preDrizzle = database.get<{ found: number }>(sql`SELECT 1 found FROM sqlite_master WHERE type='table' AND name='schema_migrations'`)
  const latest = migrations.at(-1)
  const drizzleJournal = database.get<{ found: number }>(
    sql`SELECT 1 found FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`,
  )
  const applied = drizzleJournal
    ? database.get<{ created_at: number }>(sql`SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1`)
    : undefined
  if (preDrizzle || (latest && (applied?.created_at ?? 0) < latest.folderMillis)) beforeMigrate()
  if (preDrizzle) bootstrapPreDrizzleDatabase(database, migrations)
  database.run(sql`PRAGMA foreign_keys = OFF`)
  try {
    migrate(database, migrationConfig)
    const violations = database.all(sql`PRAGMA foreign_key_check`)
    if (violations.length > 0) throw new Error('Drizzle migration created foreign key violations')
  } finally {
    database.run(sql`PRAGMA foreign_keys = ON`)
  }
}
