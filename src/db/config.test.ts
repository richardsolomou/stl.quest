import { describe, expect, it } from 'vitest'
import { PostgreSQLBackend } from './backends/postgres'
import { SQLiteBackend } from './backends/sqlite'
import { configuredDatabaseBackend, configuredDatabaseTarget } from './config'

describe('database configuration', () => {
  it('uses local SQLite by default', async () => {
    const backend = configuredDatabaseBackend({ DATA_DIR: '/tmp/stlquest-database-config' })
    expect(backend).toBeInstanceOf(SQLiteBackend)
    await backend.close()
  })

  it('uses PostgreSQL when DATABASE_URL is configured', async () => {
    const backend = configuredDatabaseBackend({ DATABASE_URL: 'postgres://localhost/stlquest' })

    expect(backend).toBeInstanceOf(PostgreSQLBackend)
    await backend.close()
  })

  it('rejects unsupported database URLs', () => {
    expect(() => configuredDatabaseBackend({ DATABASE_URL: 'mysql://localhost/stlquest' })).toThrow('DATABASE_URL must use')
  })

  it('rejects remote SQLite URLs', () => {
    expect(() => configuredDatabaseBackend({ DATABASE_URL: 'libsql://database.example.com' })).toThrow('DATABASE_URL must use')
  })

  it('reads the SQLite file from the data directory without DATABASE_URL', () => {
    expect(configuredDatabaseTarget({}, '/data/stlquest.sqlite')).toEqual({ provider: 'sqlite', file: '/data/stlquest.sqlite' })
  })

  it.each(['postgres://user:secret@database/stlquest', 'postgresql://user:secret@database/stlquest'])('accepts %s', (url) => {
    expect(configuredDatabaseTarget({ DATABASE_URL: url })).toEqual({ provider: 'postgres', url })
  })
})
