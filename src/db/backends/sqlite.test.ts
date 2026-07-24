import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '../connection'
import { SQLiteBackend } from './sqlite'

describe('SQLiteBackend', () => {
  it('initializes SQLite connection settings and migrations', () => {
    const backend = new SQLiteBackend(createDatabase(':memory:'))

    backend.initialize()

    expect({
      foreignKeys: backend.database.get<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`)?.foreign_keys,
      migrations: backend.database.get<{ count: number }>(sql`SELECT count(*) count FROM __drizzle_migrations`)?.count,
    }).toEqual({ foreignKeys: 1, migrations: 13 })
    backend.close()
  })

  it('keeps the connection open when a shared backend closes', () => {
    const backend = new SQLiteBackend(createDatabase(':memory:'))

    backend.shared().close()

    expect(backend.database.get<{ value: number }>(sql`SELECT 1 value`)).toEqual({ value: 1 })
    backend.close()
  })

  it('recognizes nested unique constraint errors', () => {
    const backend = new SQLiteBackend(createDatabase(':memory:'))
    const error = new Error('query failed', { cause: Object.assign(new Error('unique'), { code: 'SQLITE_CONSTRAINT_UNIQUE' }) })

    expect(backend.isUniqueConstraintError(error)).toBe(true)
    backend.close()
  })
})
