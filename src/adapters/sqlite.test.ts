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
import betterAuthMigration from './migrations/005_better_auth.sql?raw'
import assetGenerationMigration from './migrations/006_asset_generation.sql?raw'
import invitesMigration from './migrations/007_invites.sql?raw'
import authRateLimitMigration from './migrations/008_auth_rate_limit.sql?raw'

describe('SqliteRepository contract', () => {
  let repository: SqliteRepository

  beforeEach(() => {
    repository = new SqliteRepository(new Database(':memory:'))
  })
  afterEach(() => repository.close())

  it('persists requests and tracks copy quantities transactionally', () => {
    const id = repository.createRequest({
      name: 'Bracket',
      fileName: 'bracket.stl',
      filePath: 'todo/bracket.stl',
      quantity: 3,
      requesterEmail: 'maker@example.com',
      requesterName: 'Maker',
      notes: 'PETG',
      sourceUrl: 'https://example.com/bracket',
    })
    expect(repository.getRequest(id)).toMatchObject({
      counts: { todo: 3, in_progress: 0, done: 0 },
      sourceUrl: 'https://example.com/bracket',
    })

    repository.moveCopies({ id, from: 'todo', to: 'in_progress', count: 2, filePath: 'todo/bracket.stl', order: 4 })
    expect(repository.getRequest(id)).toMatchObject({ counts: { todo: 1, in_progress: 2, done: 0 }, orders: { in_progress: 4 } })
    expect(() => repository.moveCopies({ id, from: 'todo', to: 'done', count: 2, filePath: 'todo/bracket.stl' })).toThrow('invalid move')
    expect(repository.getRequest(id)?.counts).toEqual({ todo: 1, in_progress: 2, done: 0 })
  })

  it('tracks thumbnail and preview generation as durable stages', () => {
    const id = repository.createRequest({
      name: 'Stages',
      fileName: 'stages.stl',
      filePath: 'todo/stages.stl',
      quantity: 1,
      requesterEmail: 'maker@example.com',
    })
    expect(repository.assetGenerationJobs(id)).toEqual([
      expect.objectContaining({ stage: 'preview', status: 'pending' }),
      expect.objectContaining({ stage: 'thumbnail', status: 'pending' }),
    ])
    repository.startAssetGeneration(id, ['thumbnail', 'preview'])
    repository.finishAssetGeneration(id, 'thumbnail', { status: 'ready', path: '.printhub/thumbnails/stages.png' })
    repository.finishAssetGeneration(id, 'preview', { status: 'skipped' })
    expect(repository.assetGenerationJobs(id)).toEqual([
      expect.objectContaining({ stage: 'preview', status: 'skipped' }),
      expect.objectContaining({ stage: 'thumbnail', status: 'ready' }),
    ])
    expect(repository.requestsNeedingAssets()).toEqual([])
  })

  it('queries request metadata, ranges, statuses, facets, and whitelisted sorting', () => {
    const bracket = repository.createRequest({
      name: 'Bracket',
      fileName: 'secret-bracket.stl',
      filePath: 'todo/bracket.stl',
      quantity: 3,
      requesterEmail: 'maker@example.com',
      requesterName: 'Maker',
      notes: 'Use orange PETG',
      sourceUrl: 'https://example.com/bracket',
      thumbnailPath: 'thumbs/bracket.png',
      previewPath: 'previews/bracket.stl',
    })
    const gear = repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 1,
      requesterEmail: 'other@example.com',
      requesterName: 'Other',
    })
    repository.moveCopies({ id: bracket, from: 'todo', to: 'in_progress', count: 1, filePath: 'todo/bracket.stl' })
    repository.database.prepare('UPDATE requests SET created_at=?,updated_at=? WHERE id=?').run(100, 300, bracket)
    repository.database.prepare('UPDATE requests SET created_at=?,updated_at=? WHERE id=?').run(200, 200, gear)

    expect(
      repository.queryRequests({ filters: { query: 'orange', hasNotes: true, hasSource: true, hasThumbnail: true, hasPreview: true } })
        .requests,
    ).toMatchObject([{ id: bracket }])
    expect(repository.queryRequests({ filters: { requester: 'maker', minQuantity: 2, maxQuantity: 4 } }).requests).toMatchObject([
      { id: bracket },
    ])
    expect(repository.queryRequests({ filters: { createdAfter: 150, updatedBefore: 250 } }).requests).toMatchObject([{ id: gear }])
    expect(
      repository.queryRequests({ filters: { hasNotes: false, hasSource: false, hasThumbnail: false, hasPreview: false } }).requests,
    ).toMatchObject([{ id: gear }])
    expect(repository.queryRequests({ filters: { sort: 'name-desc' } }).requests.map((request) => request.name)).toEqual([
      'Gear',
      'Bracket',
    ])
    expect(repository.queryRequests({ filters: { sort: 'quantity-desc' } }).requests.map((request) => request.quantity)).toEqual([3, 1])

    const result = repository.queryRequests({ filters: { requester: 'Maker' } })
    expect(result.facets).toMatchObject({ total: 1, available: 2 })
    expect(result.facets.requesters).toEqual([
      { value: 'Maker', label: 'Maker', count: 1 },
      { value: 'Other', label: 'Other', count: 1 },
    ])
  })

  it('applies visibility and ownership before returning requests or facets', () => {
    repository.createRequest({
      name: 'Mine',
      fileName: 'mine.stl',
      filePath: 'todo/mine.stl',
      quantity: 1,
      requesterEmail: 'me@example.com',
      requesterName: 'Me',
    })
    repository.createRequest({
      name: 'Theirs',
      fileName: 'theirs.stl',
      filePath: 'todo/theirs.stl',
      quantity: 1,
      requesterEmail: 'them@example.com',
      requesterName: 'Them',
    })
    const privateResult = repository.queryRequests({ visibleToEmail: 'me@example.com' })
    expect(privateResult.requests.map((request) => request.name)).toEqual(['Mine'])
    expect(privateResult.facets).toMatchObject({ total: 1, available: 1 })
    expect(repository.queryRequests({ ownerEmail: 'me@example.com' }).requests.map((request) => request.name)).toEqual(['Mine'])
  })

  it('only searches private file and email metadata when enabled', () => {
    repository.createRequest({
      name: 'Model',
      fileName: 'private-file.stl',
      filePath: 'todo/model.stl',
      quantity: 1,
      requesterEmail: 'hidden@example.com',
    })
    expect(repository.queryRequests({ filters: { query: 'private-file' } }).requests).toHaveLength(0)
    expect(repository.queryRequests({ filters: { query: 'hidden@example.com' }, searchPrivateMetadata: true }).requests).toHaveLength(1)
  })

  it('enforces quantity invariants and cascades status deletion', () => {
    const id = repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 2,
      requesterEmail: 'a@b.test',
    })
    repository.moveCopies({ id, from: 'todo', to: 'done', count: 1, filePath: 'todo/gear.stl' })
    expect(() => repository.updateRequest(id, { quantity: 0 })).toThrow()
    repository.updateRequest(id, { quantity: 4, notes: 'four please', sourceUrl: 'https://example.com/gear' })
    expect(repository.getRequest(id)).toMatchObject({
      quantity: 4,
      counts: { todo: 3, done: 1 },
      notes: 'four please',
      sourceUrl: 'https://example.com/gear',
    })
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

  it('persists plate model dimensions and cascades them with requests', () => {
    const id = repository.createRequest({
      name: 'Cached model',
      fileName: 'cached.stl',
      filePath: 'todo/cached.stl',
      quantity: 1,
      requesterEmail: 'owner@example.com',
    })
    repository.upsertPlateModelAnalyses([
      {
        requestId: id,
        contentHash: 'a'.repeat(64),
        widthMm: 12,
        depthMm: 18,
        heightMm: 42,
        orientationCandidates: [
          {
            quaternion: [0, 0, 0, 1],
            widthMm: 12,
            depthMm: 18,
            heightMm: 42,
            islandCount: 0,
            islandRisk: 0,
            supportAreaMm2: 20,
            estimatedVolumeMm3: 1_000,
            supportSpreadMm: 4,
            centerOfMassOffsetMm: 1,
            stabilityRisk: 2,
            loadPathRisk: 3,
            score: 77,
          },
        ],
      },
    ])
    expect(repository.listPlateModelAnalyses()).toEqual([
      expect.objectContaining({
        requestId: id,
        contentHash: 'a'.repeat(64),
        widthMm: 12,
        orientationCandidates: [expect.objectContaining({ islandCount: 0, supportAreaMm2: 20 })],
      }),
    ])
    repository.upsertPlateModelAnalyses([{ requestId: id, widthMm: 13, depthMm: 19, heightMm: 43 }])
    expect(repository.listPlateModelAnalyses()).toEqual([
      expect.objectContaining({ requestId: id, analysisVersion: 1, widthMm: 13, depthMm: 19, heightMm: 43 }),
    ])
    repository.deleteRequest(id)
    expect(repository.listPlateModelAnalyses()).toEqual([])
  })

  it('maintains integrity, exposes database information, and installs the auth limiter table', () => {
    const maintenance = repository.maintain()
    expect(maintenance.integrity).toBe('ok')
    expect(maintenance.checkedAt).toBeGreaterThan(0)
    expect(repository.databaseInfo()).toMatchObject({ path: ':memory:', sizeBytes: 0, integrity: 'ok' })
    expect(repository.database.pragma('journal_mode', { simple: true })).toBe('memory')
    expect(repository.database.pragma('synchronous', { simple: true })).toBe(2)
    expect(repository.database.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(repository.database.pragma('busy_timeout', { simple: true })).toBe(5000)
    expect(repository.database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rateLimit'").get()).toEqual({
      name: 'rateLimit',
    })
  })

  it('creates a consistent online backup', async () => {
    const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-backup-'))
    const source = path.join(temporary, 'source.sqlite')
    const destination = path.join(temporary, 'backups', 'copy.sqlite')
    const persisted = SqliteRepository.open(source)
    try {
      const id = persisted.createRequest({
        name: 'Backup probe',
        fileName: 'probe.stl',
        filePath: 'todo/probe.stl',
        quantity: 1,
        requesterEmail: 'maker@example.com',
      })
      await persisted.backup(destination)
      const copy = new Database(destination, { readonly: true })
      try {
        expect(copy.pragma('quick_check', { simple: true })).toBe('ok')
        expect(copy.prepare('SELECT name FROM requests WHERE id=?').get(id)).toEqual({ name: 'Backup probe' })
      } finally {
        copy.close()
      }
      expect(persisted.databaseInfo()).toMatchObject({ path: source, integrity: 'ok' })
      expect(persisted.databaseInfo().sizeBytes).toBeGreaterThan(0)
      expect((await fs.promises.readdir(path.dirname(destination))).filter((file) => file.endsWith('.tmp'))).toEqual([])
    } finally {
      persisted.close()
      await fs.promises.rm(temporary, { recursive: true, force: true })
    }
  })

  it('reads users and people from the better-auth user table', () => {
    const iso = new Date().toISOString()
    repository.database
      .prepare('INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt,role,color) VALUES (?,?,?,0,?,?,?,?)')
      .run('u1', 'Maker', 'maker@example.com', iso, iso, 'requester', '#fa0')
    repository.database
      .prepare('INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt,role) VALUES (?,?,?,0,?,?,?)')
      .run('u2', 'Zed', 'zed@example.com', iso, iso, 'admin')
    expect(repository.listUsers()).toEqual([
      { id: 'u2', email: 'zed@example.com', name: 'Zed', role: 'admin' },
      { id: 'u1', email: 'maker@example.com', name: 'Maker', role: 'requester' },
    ])
    expect(repository.listPeople()).toEqual([
      { name: 'Maker', color: '#fa0' },
      { name: 'Zed', color: undefined },
    ])
    expect(repository.countUsers()).toBe(2)
  })

  it('persists operation state transitions with the associated metadata commit', () => {
    const id = repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 1,
      requesterEmail: 'a@b.test',
    })
    const operationId = crypto.randomUUID()
    repository.beginOperation(operationId, {
      kind: 'move',
      requestId: id,
      fromStatus: 'todo',
      toStatus: 'done',
      count: 1,
      sourcePath: 'todo/gear.stl',
      destinationPath: 'done/gear.stl',
    })
    repository.markOperationAssetsMoved(operationId)
    repository.completeMoveOperation(operationId, { id, from: 'todo', to: 'done', count: 1, filePath: 'done/gear.stl' })
    expect(repository.getRequest(id)).toMatchObject({ counts: { todo: 0, done: 1 }, filePath: 'done/gear.stl' })
    expect(repository.listOperations()).toMatchObject([{ id: operationId, state: 'committed' }])
    repository.finishOperation(operationId)
    expect(repository.listOperations()).toHaveLength(0)
  })

  it('replaces stale ordering when a status is re-entered', () => {
    const id = repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 1,
      requesterEmail: 'a@b.test',
    })
    repository.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1, filePath: 'in-progress/gear.stl', order: 4 })
    repository.moveCopies({ id, from: 'in_progress', to: 'todo', count: 1, filePath: 'todo/gear.stl', order: 2 })
    repository.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1, filePath: 'in-progress/gear.stl', order: 9 })
    expect(repository.getRequest(id)?.orders).toMatchObject({ todo: undefined, in_progress: 9 })
  })

  it('migrates legacy users, hashes, and roles into the better-auth tables', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)')
    for (const [version, sql] of [
      [1, initialMigration],
      [2, operationsMigration],
      [3, uploadsMigration],
      [4, settingsMigration],
    ] as const) {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(version, Date.now())
    }
    db.prepare('INSERT INTO users (id,email,name,password_hash,role,color,created_at) VALUES (?,?,?,?,?,?,?)').run(
      'legacy-op',
      'op@example.com',
      'Op',
      '$argon2id$fake',
      'operator',
      '#0af',
      1700000000000,
    )
    db.prepare('INSERT INTO users (id,email,name,password_hash,role,created_at) VALUES (?,?,?,NULL,?,?)').run(
      'legacy-req',
      'req@example.com',
      'Req',
      'requester',
      1700000000000,
    )
    const migrated = new SqliteRepository(db)
    expect(migrated.listUsers()).toEqual([
      { id: 'legacy-op', email: 'op@example.com', name: 'Op', role: 'admin' },
      { id: 'legacy-req', email: 'req@example.com', name: 'Req', role: 'requester' },
    ])
    const account = db.prepare('SELECT accountId, providerId, password FROM account WHERE userId=?').get('legacy-op')
    expect(account).toEqual({ accountId: 'legacy-op', providerId: 'credential', password: '$argon2id$fake' })
    expect(db.prepare('SELECT count(*) count FROM account').get()).toEqual({ count: 1 })
    const created = db.prepare('SELECT createdAt FROM "user" WHERE id=?').get('legacy-op') as { createdAt: string }
    expect(new Date(created.createdAt).getTime()).toBe(1700000000000)
    migrated.close()
  })

  it('renames existing privileged users and outstanding invites to admin', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)')
    for (const [version, sql] of [
      [1, initialMigration],
      [2, operationsMigration],
      [3, uploadsMigration],
      [4, settingsMigration],
    ] as const) {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(version, Date.now())
    }
    db.prepare('INSERT INTO users (id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)').run(
      'legacy-admin',
      'admin@example.com',
      'Admin',
      '$argon2id$fake',
      'operator',
      1700000000000,
    )
    for (const [version, sql] of [
      [5, betterAuthMigration],
      [6, assetGenerationMigration],
      [7, invitesMigration],
      [8, authRateLimitMigration],
    ] as const) {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(version, Date.now())
    }
    db.prepare('INSERT INTO invites (id,token_hash,role,created_at,expires_at) VALUES (?,?,?,?,?)').run(
      'legacy-invite',
      'token-hash',
      'operator',
      1700000000000,
      1800000000000,
    )

    const migrated = new SqliteRepository(db)

    expect(migrated.listUsers()).toContainEqual(expect.objectContaining({ email: 'admin@example.com', role: 'admin' }))
    expect(migrated.listInvites()).toContainEqual(expect.objectContaining({ id: 'legacy-invite', role: 'admin' }))
    expect(() =>
      migrated.database
        .prepare('INSERT INTO invites (id,token_hash,role,created_at,expires_at) VALUES (?,?,?,?,?)')
        .run('invalid-invite', 'invalid-token', 'operator', 1700000000000, 1800000000000),
    ).toThrow()
    migrated.close()
  })

  it('reconciles added statuses and rejects removed statuses that contain copies', () => {
    const id = repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 1,
      requesterEmail: 'a@b.test',
    })
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
    expect(() => repository.createUploadSession('persisted-upload-id', 'attacker', expires, 3)).toThrow(
      expect.objectContaining({ status: 409 }),
    )
  })

  it('atomically reserves a request against overlapping durable operations', () => {
    const id = repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 1,
      requesterEmail: 'a@b.test',
    })
    repository.beginOperation(crypto.randomUUID(), {
      kind: 'move',
      requestId: id,
      fromStatus: 'todo',
      toStatus: 'done',
      count: 1,
      sourcePath: 'todo/gear.stl',
      destinationPath: 'done/gear.stl',
    })
    expect(() => repository.beginOperation(crypto.randomUUID(), { kind: 'delete', requestId: id, assets: [] })).toThrow(
      expect.objectContaining({ status: 409 }),
    )
    expect(() => repository.updateRequest(id, { quantity: 2 })).toThrow(expect.objectContaining({ status: 409 }))
    expect(repository.getRequest(id)).toMatchObject({ quantity: 1, filePath: 'todo/gear.stl' })
  })

  it('does not persist a newly rejected upload session', () => {
    const expires = Date.now() + 60_000
    for (const id of ['quota-upload-one', 'quota-upload-two', 'quota-upload-three']) {
      expect(repository.createUploadSession(id, 'owner', expires, 3)).toEqual({ fresh: true })
      expect(repository.reserveUpload(id, 'owner', 1, expires, { count: 3, bytes: 100 })).toBe(true)
    }
    expect(() => repository.createUploadSession('quota-upload-four', 'owner', expires, 3)).toThrow(expect.objectContaining({ status: 429 }))
    const raw = (repository as unknown as { db: Database.Database }).db
    expect((raw.prepare('SELECT count(*) count FROM upload_sessions WHERE owner_id=?').get('owner') as { count: number }).count).toBe(3)
    repository.expireUploads(expires + 1)
    expect(repository.createUploadSession('quota-upload-four', 'owner', expires + 60_000, 3)).toEqual({ fresh: true })
  })

  it('does not let rejected upload creations consume future quota', () => {
    const expires = Date.now() + 60_000
    for (const id of ['rejected-upload-one', 'rejected-upload-two', 'rejected-upload-three']) {
      repository.createUploadSession(id, 'owner', expires, 3)
      expect(repository.reserveUpload(id, 'owner', 101, expires, { count: 3, bytes: 100 })).toBe(false)
    }
    expect(repository.createUploadSession('accepted-upload', 'owner', expires, 3)).toEqual({ fresh: true })
    expect(repository.reserveUpload('accepted-upload', 'owner', 100, expires, { count: 3, bytes: 100 })).toBe(true)
    expect(repository.incompleteUploadStats(Date.now())).toEqual({ count: 1, bytes: 100 })
  })

  it('enforces incomplete-upload quotas after reopening the database', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-sqlite-'))
    const file = path.join(directory, 'test.sqlite')
    const expires = Date.now() + 60_000
    const first = SqliteRepository.open(file)
    first.createUploadSession('restart-upload-one', 'owner', expires, 3)
    expect(first.reserveUpload('restart-upload-one', 'owner', 70, expires, { count: 2, bytes: 100 })).toBe(true)
    first.createUploadSession('restart-upload-two', 'owner', expires, 2)
    expect(first.reserveUpload('restart-upload-two', 'owner', 30, expires, { count: 2, bytes: 100 })).toBe(true)
    expect(() => first.createUploadSession('restart-upload-rejected', 'owner', expires, 2)).toThrow(
      expect.objectContaining({ status: 429 }),
    )
    first.close()
    const reopened = SqliteRepository.open(file)
    expect(reopened.reserveUpload('restart-upload-two', 'owner', 31, expires, { count: 2, bytes: 100 })).toBe(false)
    expect(reopened.createUploadSession('restart-upload-one', 'owner', expires, 2)).toEqual({ fresh: false })
    expect(() => reopened.createUploadSession('restart-upload-rejected', 'owner', expires, 2)).toThrow(
      expect.objectContaining({ status: 429 }),
    )
    reopened.close()
    await fs.promises.rm(directory, { recursive: true, force: true })
  })
})
