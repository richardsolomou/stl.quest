import type { DatabaseBackend } from './backend'
import { PostgreSQLBackend } from './backends/postgres'
import { SQLiteBackend } from './backends/sqlite'
import type { STLQuestDatabase } from './connection'
import { databasePath } from './paths'

export function configuredDatabaseBackend(env: NodeJS.ProcessEnv = process.env): DatabaseBackend<STLQuestDatabase> {
  const target = configuredDatabaseTarget(env)
  return target.provider === 'postgres' ? PostgreSQLBackend.open(target.url) : SQLiteBackend.open(target.file)
}

/** PostgreSQL when `DATABASE_URL` is set, otherwise the SQLite file in the data directory. */
export function configuredDatabaseTarget(env: NodeJS.ProcessEnv = process.env, sqliteFile = databasePath(env.DATA_DIR)) {
  const url = env.DATABASE_URL?.trim()
  if (!url) return { provider: 'sqlite' as const, file: sqliteFile }
  const protocol = URL.parse(url)?.protocol
  if (protocol !== 'postgres:' && protocol !== 'postgresql:') throw new Error('DATABASE_URL must use a postgres:// or postgresql:// URL')
  return { provider: 'postgres' as const, url }
}
