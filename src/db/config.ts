import type { DatabaseBackend } from './backend'
import { PostgreSQLBackend } from './backends/postgres'
import { SQLiteBackend } from './backends/sqlite'
import type { STLQuestDatabase } from './connection'
import { databasePath } from './paths'

export function configuredDatabaseBackend(env: NodeJS.ProcessEnv = process.env): DatabaseBackend<STLQuestDatabase> {
  const url = env.DATABASE_URL?.trim()
  if (!url) return SQLiteBackend.open(databasePath(env.DATA_DIR))
  if (/^postgres(?:ql)?:\/\//i.test(url)) return PostgreSQLBackend.open(url)
  throw new Error('DATABASE_URL must use a postgres:// or postgresql:// URL')
}
