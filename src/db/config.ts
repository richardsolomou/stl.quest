import type { DatabaseBackend } from './backend'
import { databaseTarget } from 'ras-stack/database'
import { PostgreSQLBackend } from './backends/postgres'
import { SQLiteBackend } from './backends/sqlite'
import type { STLQuestDatabase } from './connection'
import { databasePath } from './paths'

export function configuredDatabaseBackend(env: NodeJS.ProcessEnv = process.env): DatabaseBackend<STLQuestDatabase> {
  const target = configuredDatabaseTarget(env)
  return target.provider === 'postgres' ? PostgreSQLBackend.open(target.url) : SQLiteBackend.open(target.file)
}

export function configuredDatabaseTarget(env: NodeJS.ProcessEnv = process.env, sqliteFile = databasePath(env.DATA_DIR)) {
  try {
    return databaseTarget({ databaseUrl: env.DATABASE_URL, sqliteFile })
  } catch {
    throw new Error('DATABASE_URL must use a postgres:// or postgresql:// URL')
  }
}
