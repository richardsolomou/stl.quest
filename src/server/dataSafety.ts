import { sql } from 'drizzle-orm'
import fs from 'node:fs'
import path from 'node:path'
import { closeDatabase, openDatabase } from '../db'

const NETWORK_FILESYSTEMS = new Map([
  [0x6969, 'NFS'],
  [0x517b, 'SMB'],
  [0xff534d42, 'CIFS'],
])

export function networkFilesystem(dataDirectory: string) {
  const type = fs.statfsSync(dataDirectory).type >>> 0
  return NETWORK_FILESYSTEMS.get(type)
}

export function acquireDataDirectoryLease(dataDirectory = path.resolve(process.env.DATA_DIR ?? '/data')) {
  fs.mkdirSync(dataDirectory, { recursive: true })
  const file = path.join(dataDirectory, 'stlquest.lock')
  const database = openDatabase(file, { timeout: 0 })
  try {
    database.run(sql`PRAGMA journal_mode = DELETE`)
    database.run(sql`PRAGMA busy_timeout = 0`)
    database.run(sql`CREATE TABLE IF NOT EXISTS lease (id INTEGER PRIMARY KEY CHECK (id = 1))`)
    database.run(sql`BEGIN EXCLUSIVE`)
  } catch (error) {
    closeDatabase(database)
    throw new Error(`another STL Quest process is already using ${dataDirectory}`, { cause: error })
  }
  let released = false
  return {
    file,
    release() {
      if (released) return
      released = true
      database.run(sql`ROLLBACK`)
      closeDatabase(database)
    },
  }
}
