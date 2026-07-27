import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PostgreSQLBackend } from './backends/postgres'
import { SQLiteBackend } from './backends/sqlite'
import { migrateSQLiteToPostgreSQL } from './migrateToPostgres'
import { schema } from './schema'

const databaseUrl = process.env.POSTGRES_MIGRATION_TEST_URL
const describeMigration = databaseUrl ? describe : describe.skip

describeMigration('SQLite to PostgreSQL migration', () => {
  let temporary: string
  let sourcePath: string

  beforeAll(async () => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'stlquest-postgres-migration-'))
    sourcePath = path.join(temporary, 'stlquest.sqlite')
    const source = SQLiteBackend.open(sourcePath)
    await source.initialize()
    const now = new Date('2026-01-02T03:04:05.000Z')
    await source.database
      .insert(schema.user)
      .values({
        id: 'user-1',
        name: 'Admin',
        email: 'admin@example.com',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
        twoFactorEnabled: false,
      })
      .run()
    await source.database
      .insert(schema.organization)
      .values({ id: 'workspace-1', name: 'Workshop', slug: 'workshop', createdAt: now })
      .run()
    await source.database
      .insert(schema.settings)
      .values({ workspaceId: 'workspace-1', key: 'storage', valueJson: '{"adapter":"s3"}', updatedAt: now.getTime() })
      .run()
    source.close()
  })

  afterAll(() => fs.rmSync(temporary, { recursive: true, force: true }))

  it('preserves typed rows and relationships', async () => {
    await migrateSQLiteToPostgreSQL(sourcePath, databaseUrl!)
    const destination = PostgreSQLBackend.open(databaseUrl!)
    await destination.initialize()
    const workspace = await destination.database.select().from(schema.organization).get()
    await destination.close()

    expect(workspace).toMatchObject({ id: 'workspace-1', slug: 'workshop', createdAt: new Date('2026-01-02T03:04:05.000Z') })
  })

  it('refuses to merge into a non-empty target', async () => {
    await expect(migrateSQLiteToPostgreSQL(sourcePath, databaseUrl!)).rejects.toThrow('PostgreSQL target is not empty')
  })

  it('refuses operations that still depend on local upload staging', async () => {
    const source = SQLiteBackend.open(sourcePath)
    await source.initialize()
    await source.database
      .insert(schema.operations)
      .values({
        id: 'operation-1',
        workspaceId: 'workspace-1',
        kind: 'upload',
        uploadId: 'upload-1',
        payloadJson: '{"kind":"upload"}',
        state: 'prepared',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run()
    source.close()

    await expect(migrateSQLiteToPostgreSQL(sourcePath, databaseUrl!)).rejects.toThrow(
      'an unfinished upload operation still depends on local staging',
    )
  })
})
