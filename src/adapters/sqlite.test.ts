import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteRepository } from './sqlite'
import initialMigration from './migrations/001_initial.sql?raw'
import operationsMigration from './migrations/002_operations.sql?raw'
import uploadsMigration from './migrations/003_uploads_and_reservations.sql?raw'
import settingsMigration from './migrations/004_settings.sql?raw'

describe('SqliteRepository contract', () => {
  let repository: SqliteRepository

  beforeEach(() => { repository = new SqliteRepository(new Database(':memory:')) })
  afterEach(() => repository.close())

  it('persists requests and tracks copy quantities transactionally', () => {
    const id = repository.createRequest({
      name: 'Bracket', fileName: 'bracket.stl', filePath: 'todo/bracket.stl', quantity: 3,
      requesterEmail: 'maker@example.com', requesterName: 'Maker', notes: 'PETG', sourceUrl: 'https://example.com/bracket',
    })
    expect(repository.getRequest(id)).toMatchObject({ counts: { todo: 3, in_progress: 0, done: 0 }, sourceUrl: 'https://example.com/bracket' })

    repository.moveCopies({ id, from: 'todo', to: 'in_progress', count: 2, filePath: 'todo/bracket.stl', order: 4 })
    expect(repository.getRequest(id)).toMatchObject({ counts: { todo: 1, in_progress: 2, done: 0 }, orders: { in_progress: 4 } })
    expect(() => repository.moveCopies({ id, from: 'todo', to: 'done', count: 2, filePath: 'todo/bracket.stl' })).toThrow('invalid move')
    expect(repository.getRequest(id)?.counts).toEqual({ todo: 1, in_progress: 2, done: 0 })
  })

  it('enforces quantity invariants and cascades status deletion', () => {
    const id = repository.createRequest({ name: 'Gear', fileName: 'gear.stl', filePath: 'todo/gear.stl', quantity: 2, requesterEmail: 'a@b.test' })
    repository.moveCopies({ id, from: 'todo', to: 'done', count: 1, filePath: 'todo/gear.stl' })
    expect(() => repository.updateRequest(id, { quantity: 0 })).toThrow()
    repository.updateRequest(id, { quantity: 4, notes: 'four please', sourceUrl: 'https://example.com/gear' })
    expect(repository.getRequest(id)).toMatchObject({ quantity: 4, counts: { todo: 3, done: 1 }, notes: 'four please', sourceUrl: 'https://example.com/gear' })
    repository.deleteRequest(id)
    expect(repository.getRequest(id)).toBeUndefined()
  })

  it('round-trips JSON settings by key', () => {
    expect(repository.getSetting('storage')).toBeUndefined()
    repository.setSetting('storage', { adapter: 'local', root: '/prints' })
    expect(repository.getSetting('storage')).toEqual({ adapter: 'local', root: '/prints' })
    repository.setSetting('storage', { adapter: 's3', bucket: 'prints' })
    expect(repository.getSetting('storage')).toEqual({ adapter: 's3', bucket: 'prints' })
  })

  it('reads users and people from the better-auth user table', () => {
    const iso = new Date().toISOString()
    repository.database.prepare('INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt,role,color) VALUES (?,?,?,0,?,?,?,?)')
      .run('u1', 'Maker', 'maker@example.com', iso, iso, 'requester', '#fa0')
    expect(repository.listUsers()).toEqual([{ id: 'u1', email: 'maker@example.com', name: 'Maker', role: 'requester' }])
    expect(repository.listPeople()).toEqual([{ name: 'Maker', color: '#fa0' }])
    expect(repository.countUsers()).toBe(1)
  })

  it('persists operation state transitions with the associated metadata commit', () => {
    const id = repository.createRequest({ name: 'Gear', fileName: 'gear.stl', filePath: 'todo/gear.stl', quantity: 1, requesterEmail: 'a@b.test' })
    const operationId = crypto.randomUUID()
    repository.beginOperation(operationId, {
      kind: 'move', requestId: id, fromStatus: 'todo', toStatus: 'done', count: 1,
      sourcePath: 'todo/gear.stl', destinationPath: 'done/gear.stl',
    })
    repository.markOperationAssetsMoved(operationId)
    repository.completeMoveOperation(operationId, { id, from: 'todo', to: 'done', count: 1, filePath: 'done/gear.stl' })
    expect(repository.getRequest(id)).toMatchObject({ counts: { todo: 0, done: 1 }, filePath: 'done/gear.stl' })
    expect(repository.listOperations()).toMatchObject([{ id: operationId, state: 'committed' }])
    repository.finishOperation(operationId)
    expect(repository.listOperations()).toHaveLength(0)
  })

  it('replaces stale ordering when a status is re-entered', () => {
    const id = repository.createRequest({ name: 'Gear', fileName: 'gear.stl', filePath: 'todo/gear.stl', quantity: 1, requesterEmail: 'a@b.test' })
    repository.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1, filePath: 'in-progress/gear.stl', order: 4 })
    repository.moveCopies({ id, from: 'in_progress', to: 'todo', count: 1, filePath: 'todo/gear.stl', order: 2 })
    repository.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1, filePath: 'in-progress/gear.stl', order: 9 })
    expect(repository.getRequest(id)?.orders).toMatchObject({ todo: undefined, in_progress: 9 })
  })

  it('migrates legacy users, hashes, and roles into the better-auth tables', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)')
    for (const [version, sql] of [[1, initialMigration], [2, operationsMigration], [3, uploadsMigration], [4, settingsMigration]] as const) {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(version, Date.now())
    }
    db.prepare('INSERT INTO users (id,email,name,password_hash,role,color,created_at) VALUES (?,?,?,?,?,?,?)')
      .run('legacy-op', 'op@example.com', 'Op', '$argon2id$fake', 'operator', '#0af', 1700000000000)
    db.prepare('INSERT INTO users (id,email,name,password_hash,role,created_at) VALUES (?,?,?,NULL,?,?)')
      .run('legacy-req', 'req@example.com', 'Req', 'requester', 1700000000000)
    const migrated = new SqliteRepository(db)
    expect(migrated.listUsers()).toEqual([
      { id: 'legacy-op', email: 'op@example.com', name: 'Op', role: 'operator' },
      { id: 'legacy-req', email: 'req@example.com', name: 'Req', role: 'requester' },
    ])
    const account = db.prepare('SELECT accountId, providerId, password FROM account WHERE userId=?').get('legacy-op')
    expect(account).toEqual({ accountId: 'legacy-op', providerId: 'credential', password: '$argon2id$fake' })
    expect(db.prepare('SELECT count(*) count FROM account').get()).toEqual({ count: 1 })
    const created = db.prepare('SELECT createdAt FROM "user" WHERE id=?').get('legacy-op') as { createdAt: string }
    expect(new Date(created.createdAt).getTime()).toBe(1700000000000)
    migrated.close()
  })

  it('reconciles added statuses and rejects removed statuses that contain copies', () => {
    const id = repository.createRequest({ name: 'Gear', fileName: 'gear.stl', filePath: 'todo/gear.stl', quantity: 1, requesterEmail: 'a@b.test' })
    const raw = (repository as unknown as { db: Database.Database }).db
    raw.prepare("DELETE FROM request_statuses WHERE request_id=? AND status_id='done'").run(id)
    repository.reconcileWorkflow()
    expect(repository.getRequest(id)?.counts.done).toBe(0)
    raw.prepare("INSERT INTO request_statuses VALUES (?, 'retired', 1, NULL)").run(id)
    expect(() => repository.reconcileWorkflow()).toThrow('still has copies')
  })

  it('persists incomplete-upload ownership, quotas, and completion receipts', () => {
    const expires = Date.now() + 60_000
    expect(repository.createUploadSession('persisted-upload-id', 'owner', expires, 3)).toEqual({ fresh: true })
    expect(repository.reserveUpload('persisted-upload-id', 'owner', 60, expires, { count: 2, bytes: 100 })).toBe(true)
    repository.createUploadSession('second-upload-id', 'owner', expires, 3)
    expect(repository.reserveUpload('second-upload-id', 'owner', 41, expires, { count: 2, bytes: 100 })).toBe(false)
    expect(() => repository.createUploadSession('persisted-upload-id', 'attacker', expires, 3)).toThrow(expect.objectContaining({ status: 409 }))
  })

  it('atomically reserves a request against overlapping durable operations', () => {
    const id = repository.createRequest({ name: 'Gear', fileName: 'gear.stl', filePath: 'todo/gear.stl', quantity: 1, requesterEmail: 'a@b.test' })
    repository.beginOperation(crypto.randomUUID(), {
      kind: 'move', requestId: id, fromStatus: 'todo', toStatus: 'done', count: 1,
      sourcePath: 'todo/gear.stl', destinationPath: 'done/gear.stl',
    })
    expect(() => repository.beginOperation(crypto.randomUUID(), { kind: 'delete', requestId: id, assets: [] }))
      .toThrow(expect.objectContaining({ status: 409 }))
    expect(() => repository.updateRequest(id, { quantity: 2 })).toThrow(expect.objectContaining({ status: 409 }))
    expect(repository.getRequest(id)).toMatchObject({ quantity: 1, filePath: 'todo/gear.stl' })
  })

  it('does not persist a newly rejected upload session', () => {
    const expires = Date.now() + 60_000
    for (const id of ['quota-upload-one', 'quota-upload-two', 'quota-upload-three']) {
      expect(repository.createUploadSession(id, 'owner', expires, 3)).toEqual({ fresh: true })
    }
    expect(() => repository.createUploadSession('quota-upload-four', 'owner', expires, 3)).toThrow(expect.objectContaining({ status: 429 }))
    const raw = (repository as unknown as { db: Database.Database }).db
    expect((raw.prepare('SELECT count(*) count FROM upload_sessions WHERE owner_id=?').get('owner') as { count: number }).count).toBe(3)
    repository.expireUploads(expires + 1)
    expect(repository.createUploadSession('quota-upload-four', 'owner', expires + 60_000, 3)).toEqual({ fresh: true })
  })

  it('enforces incomplete-upload quotas after reopening the database', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-sqlite-'))
    const file = path.join(directory, 'test.sqlite')
    const expires = Date.now() + 60_000
    const first = SqliteRepository.open(file)
    first.createUploadSession('restart-upload-one', 'owner', expires, 3)
    expect(first.reserveUpload('restart-upload-one', 'owner', 70, expires, { count: 2, bytes: 100 })).toBe(true)
    first.createUploadSession('restart-upload-two', 'owner', expires, 2)
    expect(() => first.createUploadSession('restart-upload-rejected', 'owner', expires, 2)).toThrow(expect.objectContaining({ status: 429 }))
    first.close()
    const reopened = SqliteRepository.open(file)
    expect(reopened.reserveUpload('restart-upload-two', 'owner', 31, expires, { count: 2, bytes: 100 })).toBe(false)
    expect(reopened.createUploadSession('restart-upload-one', 'owner', expires, 2)).toEqual({ fresh: false })
    expect(() => reopened.createUploadSession('restart-upload-rejected', 'owner', expires, 2)).toThrow(expect.objectContaining({ status: 429 }))
    reopened.close()
    await fs.promises.rm(directory, { recursive: true, force: true })
  })
})
