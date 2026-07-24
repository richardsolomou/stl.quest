import fs from 'node:fs'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import type { DatabaseBackend } from '../backend'
import { backupDatabase } from '../backup'
import { closeDatabase, databaseFile, openDatabase, type STLQuestDatabase } from '../connection'
import { migrateDatabase } from '../migrations'

export class SQLiteBackend implements DatabaseBackend<STLQuestDatabase> {
  private lastIntegrity = { integrity: 'unknown', checkedAt: 0 }

  constructor(
    readonly database: STLQuestDatabase,
    private readonly ownsDatabase = true,
  ) {}

  static open(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    return new SQLiteBackend(openDatabase(file))
  }

  shared() {
    return new SQLiteBackend(this.database, false)
  }

  initialize() {
    this.database.run(sql`PRAGMA journal_mode = WAL`)
    this.database.run(sql`PRAGMA synchronous = FULL`)
    this.database.run(sql`PRAGMA foreign_keys = ON`)
    this.database.run(sql`PRAGMA busy_timeout = 5000`)
    migrateDatabase(this.database, () => this.backupBeforeMigration())
    this.maintain()
  }

  close() {
    if (this.ownsDatabase) closeDatabase(this.database)
  }

  info() {
    const file = databaseFile(this.database)
    const sizeBytes = file && file !== ':memory:' ? fs.statSync(file).size : 0
    return {
      path: file,
      sizeBytes,
      integrity: this.lastIntegrity.integrity,
      lastCheckedAt: this.lastIntegrity.checkedAt,
    }
  }

  maintain() {
    const result = this.database.get<{ quick_check: string }>(sql`PRAGMA quick_check`)
    const integrity = result?.quick_check ?? 'unknown'
    if (integrity !== 'ok') throw new Error(`database integrity check failed: ${integrity}`)
    this.database.run(sql`PRAGMA optimize`)
    this.database.run(sql`PRAGMA wal_checkpoint(PASSIVE)`)
    this.lastIntegrity = { integrity, checkedAt: Date.now() }
    return this.lastIntegrity
  }

  backup(destination: string) {
    return backupDatabase(this.database, destination)
  }

  isUniqueConstraintError(error: unknown) {
    let current = error
    while (current && typeof current === 'object') {
      if ('code' in current && current.code === 'SQLITE_CONSTRAINT_UNIQUE') return true
      current = 'cause' in current ? current.cause : undefined
    }
    return false
  }

  private backupBeforeMigration() {
    const file = databaseFile(this.database)
    if (!file || file === ':memory:') return
    const tables = this.database.get<{ count: number }>(
      sql`SELECT count(*) count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    )
    if ((tables?.count ?? 0) === 0) return
    const directory = path.join(path.dirname(file), 'backups')
    fs.mkdirSync(directory, { recursive: true })
    const timestamp = new Date().toISOString().replaceAll(':', '-')
    this.database.run(sql`VACUUM INTO ${path.join(directory, `stlquest-pre-migration-${timestamp}.sqlite`)}`)
  }
}
