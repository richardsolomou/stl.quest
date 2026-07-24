import { describe, expect, it } from 'vitest'
import { LibSQLBackend } from './backends/libsql'
import { SQLiteBackend } from './backends/sqlite'
import { configuredDatabaseBackend } from './config'

describe('database configuration', () => {
  it('uses local SQLite by default', () => {
    const backend = configuredDatabaseBackend({ DATA_DIR: '/tmp/stlquest-database-config' })
    expect(backend).toBeInstanceOf(SQLiteBackend)
    backend.close()
  })

  it('uses remote libSQL when DATABASE_URL is configured', () => {
    const backend = configuredDatabaseBackend({ DATABASE_URL: 'https://database.example.com', DATABASE_AUTH_TOKEN: 'secret' })
    expect(backend).toBeInstanceOf(LibSQLBackend)
    backend.close()
  })

  it('rejects unsupported database URLs', () => {
    expect(() => configuredDatabaseBackend({ DATABASE_URL: 'postgres://localhost/stlquest' })).toThrow('DATABASE_URL must use')
  })
})
