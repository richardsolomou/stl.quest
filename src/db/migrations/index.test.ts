import { sql } from 'drizzle-orm'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '../connection'

const migrations = readMigrationFiles({ migrationsFolder: fileURLToPath(new URL('../../../drizzle', import.meta.url)) })
const issuerBackfill = migrations.findIndex((migration) => migration.sql.some((statement) => statement.includes('`issuer`')))

describe('SQLite migrations', () => {
  it('derives Better Auth issuers for accounts created before the upgrade', async () => {
    const database = createDatabase(':memory:')
    const apply = async (from: number, to: number) => {
      for (const migration of migrations.slice(from, to)) {
        for (const statement of migration.sql) await database.run(sql.raw(statement))
      }
    }
    await database.run(sql`PRAGMA foreign_keys = OFF`)
    await apply(0, issuerBackfill)
    const timestamp = new Date().toISOString()
    await database.run(sql`
      INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES ('user-1', 'Owner', 'owner@example.com', 1, ${timestamp}, ${timestamp})
    `)
    await database.run(sql`
      INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt)
      VALUES
        ('account-password', 'user-1', 'credential', 'user-1', ${timestamp}, ${timestamp}),
        ('account-google', 'google-subject', 'google', 'user-1', ${timestamp}, ${timestamp}),
        ('account-discord', 'discord-subject', 'discord', 'user-1', ${timestamp}, ${timestamp})
    `)

    await apply(issuerBackfill, issuerBackfill + 1)

    expect(await database.all(sql`SELECT id, issuer, providerId, accountId FROM account ORDER BY id`)).toEqual([
      { id: 'account-discord', issuer: 'local:oauth:discord', providerId: 'discord', accountId: 'discord-subject' },
      { id: 'account-google', issuer: 'local:oauth:google', providerId: 'google', accountId: 'google-subject' },
      { id: 'account-password', issuer: 'local:credential', providerId: 'credential', accountId: 'user-1' },
    ])
    expect(await database.all(sql`PRAGMA foreign_key_check`)).toEqual([])
  })
})
