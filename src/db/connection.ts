import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { ExtractTablesWithRelations } from 'drizzle-orm/relations'
import type { BaseSQLiteDatabase, SQLiteTransaction } from 'drizzle-orm/sqlite-core'
import { AsyncLocalStorage } from 'node:async_hooks'
import { schema } from './schema'

type SQLiteDatabase = BetterSQLite3Database<typeof schema> & { $client: Database.Database }
type RunResult = { changes: number }
type AsyncSQLiteTransaction = SQLiteTransaction<'async', RunResult, typeof schema, ExtractTablesWithRelations<typeof schema>>
type AsyncSQLiteDatabase = BaseSQLiteDatabase<'async', RunResult, typeof schema>

export type STLQuestDatabase = Pick<
  AsyncSQLiteDatabase,
  'all' | 'delete' | 'get' | 'insert' | 'query' | 'run' | 'select' | 'selectDistinct' | 'transaction' | 'update'
>
export type DatabaseProvider = 'sqlite' | 'pg'

const databaseProviders = new WeakMap<object, DatabaseProvider>()
const rawDatabases = new WeakMap<object, SQLiteDatabase>()

export function createDatabase(source: Database.Database | string): STLQuestDatabase {
  const raw = typeof source === 'string' ? drizzle(source, { schema }) : drizzle({ client: source, schema })
  const database = asyncDatabase(raw)
  rawDatabases.set(database, raw)
  return registerDatabaseProvider(database, 'sqlite')
}

export function registerDatabaseProvider<T extends object>(database: T, provider: DatabaseProvider): T {
  databaseProviders.set(database, provider)
  return database
}

export function databaseProvider(database: object): DatabaseProvider {
  return databaseProviders.get(database) ?? 'sqlite'
}

export function openDatabase(file: string, options?: Database.Options) {
  return createDatabase(new Database(file, options))
}

export function closeDatabase(database: STLQuestDatabase) {
  rawDatabase(database).$client.close()
}

export function databaseFile(database: STLQuestDatabase) {
  return rawDatabase(database).$client.name
}

export function rawDatabase(database: STLQuestDatabase) {
  return rawDatabases.get(database) ?? (database as unknown as SQLiteDatabase)
}

function asyncDatabase(raw: SQLiteDatabase): STLQuestDatabase {
  const context = new AsyncLocalStorage<boolean>()
  let tail = Promise.resolve()
  const wrapped = new WeakMap<object, unknown>()
  let database: STLQuestDatabase

  const execute = <T>(operation: () => T): Promise<T> => {
    if (context.getStore()) return Promise.resolve().then(operation)
    const result = tail.then(operation)
    tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  const wrap = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value
    if (wrapped.has(value)) return wrapped.get(value)
    const proxy = new Proxy(value, {
      get(target, property) {
        const member = Reflect.get(target, property, target)
        if (property === 'transaction') {
          return (callback: (transaction: AsyncSQLiteTransaction) => Promise<unknown>) =>
            execute(() =>
              context.run(true, async () => {
                raw.$client.exec('BEGIN IMMEDIATE')
                try {
                  const result = await callback(database as unknown as AsyncSQLiteTransaction)
                  raw.$client.exec('COMMIT')
                  return result
                } catch (error) {
                  raw.$client.exec('ROLLBACK')
                  throw error
                }
              }),
            )
        }
        if ((property === 'get' || property === 'all' || property === 'run') && typeof member === 'function') {
          return (...args: unknown[]) => execute(() => Reflect.apply(member, target, args))
        }
        if (typeof member !== 'function') return member
        return (...args: unknown[]) => wrap(Reflect.apply(member, target, args))
      },
    })
    wrapped.set(value, proxy)
    return proxy
  }

  database = wrap(raw) as STLQuestDatabase
  return database
}
