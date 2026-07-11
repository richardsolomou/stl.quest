import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import initialMigration from './migrations/001_initial.sql?raw'
import operationsMigration from './migrations/002_operations.sql?raw'
import durableUploadsMigration from './migrations/003_uploads_and_reservations.sql?raw'
import settingsMigration from './migrations/004_settings.sql?raw'
import type { Identity, PrintRequest, NewPrintRequest, OperationPayload, PendingOperation, Person, Repository, Role, UploadOperation } from '../core/types'
import { initialStatus, workflow } from '../core/workflow'

const migrations = [{ version: 1, sql: initialMigration }, { version: 2, sql: operationsMigration }, { version: 3, sql: durableUploadsMigration }, { version: 4, sql: settingsMigration }]

type RequestRow = {
  id: string; name: string; file_name: string; file_path: string; quantity: number
  requester_email: string; requester_name: string | null; notes: string | null; source_url: string | null; thumbnail: string | null
  preview_path: string | null; created_at: number; updated_at: number
}

export class SqliteRepository implements Repository {
  constructor(private db: Database.Database) {
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('busy_timeout = 5000')
    this.migrate()
  }

  static open(file = databasePath()) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    return new SqliteRepository(new Database(file))
  }

  close() { this.db.close() }

  listRequests() {
    return (this.db.prepare('SELECT * FROM requests ORDER BY created_at DESC').all() as RequestRow[]).map((row) => this.hydrate(row, false))
  }

  getRequest(id: string) {
    const row = this.db.prepare('SELECT * FROM requests WHERE id = ?').get(id) as RequestRow | undefined
    return row ? this.hydrate(row, true) : undefined
  }

  createRequest(request: NewPrintRequest) {
    const id = crypto.randomUUID()
    this.db.transaction(() => this.insertRequest(id, request))()
    return id
  }

  createUploadSession(uploadId: string, ownerId: string, expiresAt: number, maxIncomplete: number) {
    return this.db.transaction(() => {
      const existing = this.db.prepare('SELECT owner_id,completed_request_id FROM upload_sessions WHERE id=?').get(uploadId) as { owner_id: string; completed_request_id: string | null } | undefined
      if (existing) {
        if (existing.owner_id !== ownerId) throw new Response('upload id belongs to another user', { status: 409 })
        this.db.prepare('UPDATE upload_sessions SET expires_at=? WHERE id=? AND completed_request_id IS NULL').run(expiresAt, uploadId)
        return { fresh: false, completedRequestId: existing.completed_request_id ?? undefined }
      }
      const active = (this.db.prepare('SELECT count(*) count FROM upload_sessions WHERE owner_id=? AND completed_request_id IS NULL AND expires_at>?').get(ownerId, Date.now()) as { count: number }).count
      if (active >= maxIncomplete) throw new Response('too many incomplete uploads', { status: 429 })
      this.db.prepare('INSERT INTO upload_sessions (id,owner_id,expires_at) VALUES (?,?,?)').run(uploadId, ownerId, expiresAt)
      return { fresh: true }
    })()
  }

  reserveUpload(uploadId: string, ownerId: string, bytes: number, expiresAt: number, limits: { count: number; bytes: number }) {
    return this.db.transaction(() => {
      const session = this.db.prepare('SELECT owner_id,completed_request_id FROM upload_sessions WHERE id=?').get(uploadId) as { owner_id: string; completed_request_id: string | null } | undefined
      if (!session || session.owner_id !== ownerId || session.completed_request_id) return false
      const usage = this.db.prepare('SELECT count(*) count,coalesce(sum(bytes),0) bytes FROM upload_sessions WHERE owner_id=? AND completed_request_id IS NULL AND expires_at>?').get(ownerId, Date.now()) as { count: number; bytes: number }
      const current = this.db.prepare('SELECT bytes FROM upload_sessions WHERE id=?').get(uploadId) as { bytes: number }
      if (usage.count > limits.count || usage.bytes - current.bytes + bytes > limits.bytes) return false
      this.db.prepare('UPDATE upload_sessions SET bytes=?,expires_at=? WHERE id=?').run(bytes, expiresAt, uploadId)
      return true
    })()
  }

  expireUploads(now: number) {
    return this.db.transaction(() => {
      const ids = (this.db.prepare('SELECT id FROM upload_sessions WHERE completed_request_id IS NULL AND expires_at<=?').all(now) as { id: string }[]).map(({ id }) => id)
      this.db.prepare('DELETE FROM upload_sessions WHERE completed_request_id IS NULL AND expires_at<=?').run(now)
      return ids
    })()
  }

  activeUploadIds(now: number) {
    return new Set((this.db.prepare('SELECT id FROM upload_sessions WHERE completed_request_id IS NULL AND expires_at>?').all(now) as { id: string }[]).map(({ id }) => id))
  }

  getCompletedUpload(uploadId: string, ownerId: string) {
    return (this.db.prepare('SELECT completed_request_id id FROM upload_sessions WHERE id=? AND owner_id=?').get(uploadId, ownerId) as { id: string | null } | undefined)?.id ?? undefined
  }

  moveCopies(input: { id: string; from: string; to: string; count: number; filePath: string; order?: number }) {
    this.db.transaction(() => {
      const from = this.db.prepare('SELECT quantity FROM request_statuses WHERE request_id=? AND status_id=?').get(input.id, input.from) as { quantity: number } | undefined
      if (!from || from.quantity < input.count) throw new Error('invalid move')
      const target = this.db.prepare('SELECT quantity FROM request_statuses WHERE request_id=? AND status_id=?').get(input.id, input.to) as { quantity: number } | undefined
      if (!target) throw new Error('invalid target status')
      this.db.prepare('UPDATE request_statuses SET quantity=quantity-?, sort_order=CASE WHEN quantity-?=0 THEN NULL ELSE sort_order END WHERE request_id=? AND status_id=?').run(input.count, input.count, input.id, input.from)
      this.db.prepare('UPDATE request_statuses SET quantity=quantity+?, sort_order=CASE WHEN quantity=0 THEN ? ELSE sort_order END WHERE request_id=? AND status_id=?').run(input.count, input.order ?? null, input.id, input.to)
      this.db.prepare('UPDATE requests SET file_path=?, updated_at=? WHERE id=?').run(input.filePath, Date.now(), input.id)
    })()
  }

  reorderRequest(id: string, status: string, order: number) {
    this.db.prepare('UPDATE request_statuses SET sort_order=? WHERE request_id=? AND status_id=?').run(order, id, status)
  }

  updateRequest(id: string, fields: { name?: string; quantity?: number; requesterName?: string; notes?: string; sourceUrl?: string }) {
    this.db.transaction(() => {
      const active = this.db.prepare("SELECT 1 FROM operations WHERE request_id=? AND state<>'committed' LIMIT 1").get(id)
      if (active) throw new Response('another operation is already running for this request', { status: 409 })
      const request = this.getRequest(id)
      if (!request) throw new Error('not found')
      if (fields.quantity !== undefined) {
        const started = workflow.statuses.slice(1).reduce((sum, status) => sum + (request.counts[status.id] ?? 0), 0)
        if (fields.quantity < Math.max(started, 1)) throw new Error('cannot reduce below started copies')
        this.db.prepare('UPDATE request_statuses SET quantity=? WHERE request_id=? AND status_id=?').run(fields.quantity - started, id, initialStatus().id)
      }
      this.db.prepare(`UPDATE requests SET name=?, quantity=?, requester_name=?, notes=?, source_url=?, updated_at=? WHERE id=?`).run(
        fields.name ?? request.name, fields.quantity ?? request.quantity, fields.requesterName ?? request.requesterName ?? null,
        fields.notes ?? request.notes ?? null, fields.sourceUrl ?? request.sourceUrl ?? null, Date.now(), id,
      )
    })()
  }

  deleteRequest(id: string) { this.db.prepare('DELETE FROM requests WHERE id=?').run(id) }

  listPeople() {
    return this.db.prepare('SELECT name,color FROM users ORDER BY name').all() as Person[]
  }

  listUsers() {
    return this.db.prepare('SELECT id,email,name,role FROM users ORDER BY name').all() as Identity[]
  }

  getSetting<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value_json FROM settings WHERE key=?').get(key) as { value_json: string } | undefined
    return row ? (JSON.parse(row.value_json) as T) : undefined
  }

  setSetting(key: string, value: unknown) {
    this.db.prepare('INSERT INTO settings (key,value_json,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at')
      .run(key, JSON.stringify(value), Date.now())
  }

  findUserByEmail(email: string) { return this.user(this.db.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase())) }
  countUsers() { return (this.db.prepare('SELECT count(*) count FROM users').get() as { count: number }).count }
  countOperatorsWithPassword() {
    return (this.db.prepare("SELECT count(*) count FROM users WHERE role='operator' AND password_hash IS NOT NULL").get() as { count: number }).count
  }

  createUser(input: { email: string; name: string; passwordHash?: string; role: Role }) {
    const id = crypto.randomUUID()
    this.db.prepare('INSERT INTO users (id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)')
      .run(id, input.email.toLowerCase(), input.name, input.passwordHash ?? null, input.role, Date.now())
    return this.findUserByEmail(input.email)!
  }

  createFirstUser(input: { email: string; name: string; passwordHash: string }) {
    return this.db.transaction(() => {
      if (this.countUsers() !== 0) throw new Response('setup complete', { status: 409 })
      return this.createUser({ ...input, role: 'operator' })
    })()
  }

  passwordHash(userId: string) { return (this.db.prepare('SELECT password_hash value FROM users WHERE id=?').get(userId) as { value?: string } | undefined)?.value }
  createSession(input: { tokenHash: string; userId: string; expiresAt: number }) {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now())
    this.db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').run(input.tokenHash, input.userId, input.expiresAt)
  }
  createSessionIfPasswordHash(input: { tokenHash: string; userId: string; expiresAt: number; expectedPasswordHash: string }) {
    return this.db.transaction(() => {
      const current = this.passwordHash(input.userId)
      if (current !== input.expectedPasswordHash) return false
      this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now())
      this.db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').run(input.tokenHash, input.userId, input.expiresAt)
      return true
    })()
  }
  findSession(tokenHash: string) {
    return this.user(this.db.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?').get(tokenHash, Date.now()))
  }
  deleteSession(tokenHash: string) { this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash) }
  updatePassword(userId: string, passwordHash: string) {
    this.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash, userId)
  }
  rotatePasswordSession(input: { userId: string; expectedPasswordHash: string; passwordHash: string; tokenHash: string; expiresAt: number }) {
    return this.db.transaction(() => {
      const updated = this.db.prepare('UPDATE users SET password_hash=? WHERE id=? AND password_hash=?').run(input.passwordHash, input.userId, input.expectedPasswordHash)
      if (updated.changes !== 1) return false
      this.db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').run(input.tokenHash, input.userId, input.expiresAt)
      this.db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(input.userId, input.tokenHash)
      return true
    })()
  }

  beginOperation(id: string, payload: OperationPayload) {
    if (payload.kind === 'upload') return this.beginUploadOperation(id, payload)
    const now = Date.now()
    try {
      this.db.prepare('INSERT INTO operations (id,kind,request_id,payload_json,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, payload.kind, payload.requestId, JSON.stringify(payload), 'prepared', now, now)
    } catch (error) {
      if ((error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') throw new Response('another operation is already running for this request', { status: 409 })
      throw error
    }
  }

  beginUploadOperation(id: string, payload: UploadOperation) {
    const now = Date.now()
    this.db.transaction(() => {
      const completed = this.getCompletedUpload(payload.uploadId, payload.ownerId)
      if (completed) return
      this.db.prepare('INSERT OR IGNORE INTO operations (id,kind,request_id,upload_id,payload_json,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, payload.kind, payload.requestId, payload.uploadId, JSON.stringify(payload), 'prepared', now, now)
    })()
  }

  markOperationAssetsMoved(id: string) {
    this.db.prepare("UPDATE operations SET state='assets_moved',updated_at=? WHERE id=? AND state='prepared'").run(Date.now(), id)
  }

  completeMoveOperation(id: string, input: { id: string; from: string; to: string; count: number; filePath: string; order?: number }) {
    this.db.transaction(() => {
      const operation = this.db.prepare('SELECT state FROM operations WHERE id=?').get(id) as { state: string } | undefined
      if (!operation || operation.state === 'committed') return
      this.moveCopies(input)
      this.db.prepare("UPDATE operations SET state='committed',updated_at=? WHERE id=?").run(Date.now(), id)
    })()
  }

  completeDeleteOperation(id: string, requestId: string) {
    this.db.transaction(() => {
      const operation = this.db.prepare('SELECT state FROM operations WHERE id=?').get(id) as { state: string } | undefined
      if (!operation || operation.state === 'committed') return
      this.deleteRequest(requestId)
      this.db.prepare("UPDATE operations SET state='committed',updated_at=? WHERE id=?").run(Date.now(), id)
    })()
  }

  completeUploadOperation(id: string, payload: UploadOperation) {
    return this.db.transaction(() => {
      const completed = this.getCompletedUpload(payload.uploadId, payload.ownerId)
      if (completed) return completed
      const operation = this.db.prepare('SELECT state FROM operations WHERE id=?').get(id) as { state: string } | undefined
      if (!operation) throw new Error('upload operation is missing')
      this.insertRequest(payload.requestId, { ...payload.request, filePath: payload.destinationPath, previewPath: payload.previewDestinationPath })
      this.db.prepare('UPDATE upload_sessions SET completed_request_id=?,bytes=0 WHERE id=? AND owner_id=?').run(payload.requestId, payload.uploadId, payload.ownerId)
      this.db.prepare("UPDATE operations SET state='committed',updated_at=? WHERE id=?").run(Date.now(), id)
      return payload.requestId
    })()
  }

  listOperations() {
    return (this.db.prepare('SELECT id,state,payload_json FROM operations ORDER BY created_at').all() as { id: string; state: PendingOperation['state']; payload_json: string }[])
      .map((row) => ({ id: row.id, state: row.state, payload: JSON.parse(row.payload_json) as OperationPayload }))
  }

  finishOperation(id: string) { this.db.prepare("DELETE FROM operations WHERE id=? AND state='committed'").run(id) }
  abandonOperation(id: string) { this.db.prepare('DELETE FROM operations WHERE id=?').run(id) }

  private hydrate(row: RequestRow, thumbnail: boolean): PrintRequest {
    const states = this.db.prepare('SELECT status_id,quantity,sort_order FROM request_statuses WHERE request_id=?').all(row.id) as { status_id: string; quantity: number; sort_order: number | null }[]
    return {
      id: row.id, name: row.name, fileName: row.file_name, filePath: row.file_path, quantity: row.quantity,
      requesterEmail: row.requester_email, requesterName: row.requester_name ?? undefined, notes: row.notes ?? undefined,
      sourceUrl: row.source_url ?? undefined,
      thumbnail: thumbnail ? row.thumbnail ?? undefined : undefined, previewPath: row.preview_path ?? undefined,
      hasThumbnail: row.thumbnail !== null, createdAt: row.created_at, updatedAt: row.updated_at,
      counts: Object.fromEntries(states.map((state) => [state.status_id, state.quantity])),
      orders: Object.fromEntries(states.map((state) => [state.status_id, state.sort_order ?? undefined])),
    }
  }

  private user(value: unknown): Identity | undefined {
    const row = value as { id: string; email: string; name: string; role: Role } | undefined
    return row ? { id: row.id, email: row.email, name: row.name, role: row.role } : undefined
  }

  private insertRequest(id: string, request: NewPrintRequest) {
    const now = Date.now()
    this.db.prepare(`INSERT INTO requests (id,name,file_name,file_path,quantity,requester_email,requester_name,notes,source_url,thumbnail,preview_path,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, request.name, request.fileName, request.filePath, request.quantity, request.requesterEmail, request.requesterName ?? null, request.notes ?? null, request.sourceUrl ?? null, request.thumbnail ?? null, request.previewPath ?? null, now, now)
    const insert = this.db.prepare('INSERT INTO request_statuses (request_id,status_id,quantity) VALUES (?,?,?)')
    for (const status of workflow.statuses) insert.run(id, status.id, status.id === initialStatus().id ? request.quantity : 0)
  }

  private migrate() {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)')
    const applied = new Set((this.db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((row) => row.version))
    for (const migration of migrations) if (!applied.has(migration.version)) this.db.transaction(() => {
      this.db.exec(migration.sql)
      this.db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(migration.version, Date.now())
    })()
  }

  reconcileWorkflow() {
    this.db.transaction(() => {
      const configured = new Set(workflow.statuses.map((status) => status.id))
      const existing = this.db.prepare('SELECT DISTINCT status_id FROM request_statuses').all() as { status_id: string }[]
      for (const { status_id } of existing) {
        if (configured.has(status_id)) continue
        const used = this.db.prepare('SELECT 1 FROM request_statuses WHERE status_id=? AND quantity>0 LIMIT 1').get(status_id)
        if (used) throw new Error(`workflow status ${status_id} still has copies and cannot be removed`)
        this.db.prepare('DELETE FROM request_statuses WHERE status_id=?').run(status_id)
      }
      const insert = this.db.prepare('INSERT OR IGNORE INTO request_statuses (request_id,status_id,quantity) SELECT id,?,0 FROM requests')
      for (const status of workflow.statuses) insert.run(status.id)
    })()
  }
}

export function databasePath() {
  return path.join(path.resolve(process.env.DATA_DIR ?? '/data'), 'printhub.sqlite')
}
