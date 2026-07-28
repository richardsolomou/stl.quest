import { sql } from 'drizzle-orm'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDatabase, rawDatabase } from '../connection'
import { SQLiteBackend } from './sqlite'

describe('SQLiteBackend', () => {
  it('initializes SQLite connection settings and migrations', async () => {
    const backend = new SQLiteBackend(createDatabase(':memory:'))

    await backend.initialize()

    expect({
      foreignKeys: (await backend.database.get<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`))?.foreign_keys,
      migrations: (await backend.database.get<{ count: number }>(sql`SELECT count(*) count FROM __drizzle_migrations`))?.count,
    }).toEqual({ foreignKeys: 1, migrations: 16 })
    backend.close()
  })

  it('keeps the connection open when a shared backend closes', async () => {
    const backend = new SQLiteBackend(createDatabase(':memory:'))

    backend.shared().close()

    expect(await backend.database.get<{ value: number }>(sql`SELECT 1 value`)).toEqual({ value: 1 })
    backend.close()
  })

  it('backfills account usage when upgrading managed storage', () => {
    const database = createDatabase(':memory:')
    const client = rawDatabase(database).$client
    client.exec(`
      CREATE TABLE user (id text PRIMARY KEY NOT NULL);
      CREATE TABLE organization (id text PRIMARY KEY NOT NULL);
      CREATE TABLE managed_storage_entitlements (
        workspace_id text PRIMARY KEY NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        owner_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX managed_storage_entitlements_owner ON managed_storage_entitlements(owner_id);
      CREATE TABLE managed_storage_usage (
        workspace_id text PRIMARY KEY NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        persisted_bytes integer DEFAULT 0 NOT NULL,
        asset_reserved_bytes integer DEFAULT 0 NOT NULL
      );
      INSERT INTO user VALUES ('owner');
      INSERT INTO organization VALUES ('workspace');
      INSERT INTO managed_storage_entitlements VALUES ('workspace', 'owner');
      INSERT INTO managed_storage_usage VALUES ('workspace', 120, 30);
    `)

    client.exec(fs.readFileSync(path.resolve('drizzle/0015_shared_managed_storage.sql'), 'utf8').replaceAll('--> statement-breakpoint', ''))

    expect(client.prepare('SELECT * FROM managed_storage_accounts').get()).toEqual({
      owner_id: 'owner',
      persisted_bytes: 120,
      asset_reserved_bytes: 30,
    })
    client.close()
  })

  it('recognizes nested unique constraint errors', () => {
    const backend = new SQLiteBackend(createDatabase(':memory:'))
    const error = new Error('query failed', { cause: Object.assign(new Error('unique'), { code: 'SQLITE_CONSTRAINT_UNIQUE' }) })

    expect(backend.isUniqueConstraintError(error)).toBe(true)
    backend.close()
  })
})
