import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'
import { schema } from './schema'
import { registerDatabaseProvider, type STLQuestDatabase } from './connection'

export type PostgreSQLConnection = {
  database: STLQuestDatabase
  drizzle: PostgresJsDatabase<typeof schema>
  client: Sql
}

export function openPostgreSQL(url: string): PostgreSQLConnection {
  const client = postgres(url, {
    max: 10,
    onnotice: () => undefined,
    types: {
      bigint: { to: 20, from: [20], serialize: (value: number) => String(value), parse: Number },
      numeric: { to: 1700, from: [1700], serialize: (value: number) => String(value), parse: Number },
    },
  })
  const drizzleDatabase = drizzle(client, { schema })
  return { database: registerDatabaseProvider(compatibleDatabase(drizzleDatabase), 'pg'), drizzle: drizzleDatabase, client }
}

function compatibleDatabase(database: PostgresJsDatabase<typeof schema>): STLQuestDatabase {
  const wrapped = new WeakMap<object, unknown>()

  const wrap = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value
    if (wrapped.has(value)) return wrapped.get(value)
    const proxy = new Proxy(value, {
      get(target, property) {
        if (property === 'get') return async (query?: unknown) => first(await execute(target, query))
        if (property === 'all') return async (query?: unknown) => execute(target, query)
        if (property === 'run') return async (query?: unknown) => runResult(await execute(target, query))
        if (property === 'transaction' && 'transaction' in target) {
          return (callback: (transaction: unknown) => Promise<unknown>) =>
            Reflect.apply((target as { transaction: Function }).transaction, target, [
              (transaction: unknown) => callback(wrap(transaction)),
            ])
        }
        const member = Reflect.get(target, property, target)
        if (property === 'then' && typeof member === 'function') return member.bind(target)
        if (typeof member !== 'function') return member
        return (...args: unknown[]) => wrap(Reflect.apply(member, target, args))
      },
    })
    wrapped.set(value, proxy)
    return proxy
  }

  return wrap(database) as STLQuestDatabase
}

async function execute(target: object, query: unknown) {
  if (query !== undefined && 'execute' in target) return Reflect.apply((target as { execute: Function }).execute, target, [query])
  return await (target as PromiseLike<unknown>)
}

function first(result: unknown) {
  return Array.isArray(result) ? result[0] : result
}

function runResult(result: unknown) {
  if (result && typeof result === 'object' && 'count' in result && typeof result.count === 'number') {
    return { changes: result.count }
  }
  return result
}
