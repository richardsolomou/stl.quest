import { assertDatabaseTargetConformance, assertSqliteConformance } from 'ras-stack/conformance'
import { describe, expect, it } from 'vitest'
import { configuredDatabaseTarget } from '../db/config'
import { closeDatabase, openDatabase, rawDatabase } from '../db/connection'

describe('shared infrastructure conformance', () => {
  it('keeps both database providers selectable', () => {
    expect(() =>
      assertDatabaseTargetConformance(({ databaseUrl, sqliteFile }) => configuredDatabaseTarget({ DATABASE_URL: databaseUrl }, sqliteFile)),
    ).not.toThrow()
  })

  it('configures SQLite safely beneath the serialized facade', async () => {
    const database = openDatabase(':memory:')
    await expect(assertSqliteConformance((name) => rawDatabase(database).$client.pragma(name, { simple: true }))).resolves.toBeUndefined()
    closeDatabase(database)
  })
})
