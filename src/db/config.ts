import type { DatabaseBackend } from './backend'
import { LibSQLBackend } from './backends/libsql'
import { SQLiteBackend } from './backends/sqlite'
import type { STLQuestDatabase } from './connection'
import { databasePath } from './paths'

export function configuredDatabaseBackend(env: NodeJS.ProcessEnv = process.env): DatabaseBackend<STLQuestDatabase> {
  const url = env.DATABASE_URL?.trim()
  if (!url) return SQLiteBackend.open(databasePath())
  if (!/^(?:libsql|https|wss):\/\//i.test(url)) {
    throw new Error('DATABASE_URL must use a libsql://, https://, or wss:// URL')
  }
  return LibSQLBackend.open(url, env.DATABASE_AUTH_TOKEN)
}
