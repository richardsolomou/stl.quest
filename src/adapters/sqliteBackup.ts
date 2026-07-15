import crypto from 'node:crypto'
import { sql } from 'drizzle-orm'
import fs from 'node:fs'
import path from 'node:path'
import { closeDatabase, openDatabase, type PrintHubDatabase } from './database'

export async function backupDatabase(database: PrintHubDatabase, destination: string) {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${crypto.randomUUID()}.tmp`)
  try {
    database.run(sql`VACUUM INTO ${temporary}`)
    const copy = openDatabase(temporary, { readonly: true, fileMustExist: true })
    let totalPages = 0
    try {
      const integrity = copy.get<{ quick_check: string }>(sql`PRAGMA quick_check`)?.quick_check
      if (integrity !== 'ok') throw new Error(`backup integrity check failed: ${integrity}`)
      totalPages = copy.get<{ page_count: number }>(sql`PRAGMA page_count`)?.page_count ?? 0
    } finally {
      closeDatabase(copy)
    }
    const descriptor = fs.openSync(temporary, 'r')
    try {
      fs.fsyncSync(descriptor)
    } finally {
      fs.closeSync(descriptor)
    }
    fs.renameSync(temporary, destination)
    const directory = fs.openSync(path.dirname(destination), 'r')
    try {
      fs.fsyncSync(directory)
    } finally {
      fs.closeSync(directory)
    }
    return { totalPages, remainingPages: 0 }
  } finally {
    fs.rmSync(temporary, { force: true })
  }
}
