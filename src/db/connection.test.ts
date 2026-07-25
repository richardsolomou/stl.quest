import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, createDatabase, type STLQuestDatabase } from './connection'

describe('async SQLite connection', () => {
  let database: STLQuestDatabase

  beforeEach(async () => {
    database = createDatabase(':memory:')
    await database.run(sql`CREATE TABLE probes (value integer NOT NULL)`)
  })

  afterEach(() => closeDatabase(database))

  it('rolls back every statement when an async transaction fails', async () => {
    await expect(
      database.transaction(async (transaction) => {
        await transaction.run(sql`INSERT INTO probes (value) VALUES (1)`)
        await Promise.resolve()
        await transaction.run(sql`INSERT INTO probes (value) VALUES (2)`)
        throw new Error('abort')
      }),
    ).rejects.toThrow('abort')

    expect(await database.get<{ count: number }>(sql`SELECT count(*) count FROM probes`)).toEqual({ count: 0 })
  })

  it('does not interleave unrelated queries with an async transaction', async () => {
    let continueTransaction!: () => void
    let transactionStarted!: () => void
    const started = new Promise<void>((resolve) => (transactionStarted = resolve))
    const continuation = new Promise<void>((resolve) => (continueTransaction = resolve))
    const transaction = database.transaction(async (connection) => {
      await connection.run(sql`INSERT INTO probes (value) VALUES (1)`)
      transactionStarted()
      await continuation
      await connection.run(sql`INSERT INTO probes (value) VALUES (2)`)
    })
    await started

    let outsideQueryCompleted = false
    const outsideQuery = database.get<{ count: number }>(sql`SELECT count(*) count FROM probes`).then((result) => {
      outsideQueryCompleted = true
      return result
    })
    await Promise.resolve()
    expect(outsideQueryCompleted).toBe(false)

    continueTransaction()
    await transaction
    expect(await outsideQuery).toEqual({ count: 2 })
  })
})
