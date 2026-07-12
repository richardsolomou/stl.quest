import Database from 'better-sqlite3'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export async function backupDatabase(database: Database.Database, destination: string) {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${crypto.randomUUID()}.tmp`)
  try {
    const result = await database.backup(temporary)
    const copy = new Database(temporary, { readonly: true, fileMustExist: true })
    try {
      const integrity = copy.pragma('quick_check', { simple: true })
      if (integrity !== 'ok') throw new Error(`backup integrity check failed: ${String(integrity)}`)
    } finally {
      copy.close()
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
    return result
  } finally {
    fs.rmSync(temporary, { force: true })
  }
}
