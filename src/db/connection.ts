import { createClient, type Client, type Config } from '@libsql/client'
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { schema } from './schema'

export type STLQuestDatabase = LibSQLDatabase<typeof schema> & { $client: Client }

type ConnectionDetails = { url: string; localFile?: string; temporaryFile?: string }

const connectionDetails = new WeakMap<Client, ConnectionDetails>()

export function createDatabase(source: Client | Config | string): STLQuestDatabase {
  if (typeof source === 'object' && 'execute' in source) return drizzle(source, { schema })
  const temporaryFile = source === ':memory:' ? path.join(os.tmpdir(), `stlquest-${crypto.randomUUID()}.sqlite`) : undefined
  const config = temporaryFile ? { url: `file:${temporaryFile}` } : typeof source === 'string' ? databaseConfig(source) : source
  const client = createClient(config)
  connectionDetails.set(client, { url: config.url, localFile: localFile(config.url), temporaryFile })
  return drizzle(client, { schema })
}

export function openDatabase(file: string) {
  return createDatabase(file)
}

export function closeDatabase(database: STLQuestDatabase) {
  const temporaryFile = connectionDetails.get(database.$client)?.temporaryFile
  database.$client.close()
  if (temporaryFile) {
    for (const suffix of ['', '-shm', '-wal']) fs.rmSync(`${temporaryFile}${suffix}`, { force: true })
  }
}

export function databaseFile(database: STLQuestDatabase) {
  return connectionDetails.get(database.$client)?.localFile
}

export function databaseUrl(database: STLQuestDatabase) {
  return connectionDetails.get(database.$client)?.url
}

export function isTemporaryDatabase(database: STLQuestDatabase) {
  return Boolean(connectionDetails.get(database.$client)?.temporaryFile)
}

function databaseConfig(source: string): Config {
  if (source.startsWith('file:') || /^[a-z][a-z\d+.-]*:\/\//i.test(source)) return { url: source }
  return { url: `file:${source}` }
}

function localFile(url: string) {
  return url.startsWith('file:') ? url.slice('file:'.length) : undefined
}
