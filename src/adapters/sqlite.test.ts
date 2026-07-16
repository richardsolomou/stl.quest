import Database from 'better-sqlite3'
import { and, count, eq, sql as drizzleSql } from 'drizzle-orm'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteRepository } from './sqlite'
import { createDatabase } from '../db'
import type { PlatePlannerDraft, PrinterProfile } from '../core/platePlanner'
import { requests, requestStatuses, uploadSessions, user } from '../db/schema'

function insertUser(
  repository: SqliteRepository,
  values: { id: string; name: string; email: string; role?: 'admin' | 'requester'; color?: string },
) {
  const now = new Date()
  repository.database
    .insert(user)
    .values({ ...values, role: values.role ?? 'requester', emailVerified: true, createdAt: now, updatedAt: now })
    .run()
  repository.addWorkspaceMember(values.id, values.role === 'admin' ? 'admin' : 'member')
}

function createPreDrizzleDatabase(file = ':memory:', version = 19) {
  const database = new Database(file)
  const initialized = new SqliteRepository(createDatabase(database))
  initialized.database.run(drizzleSql`PRAGMA foreign_keys = OFF`)
  database.exec(`
    DROP TABLE __drizzle_migrations;
    DROP TABLE invitation;
    DROP TABLE member;
    DROP TABLE deployment_settings;
    DROP TABLE settings;
    DROP TABLE operations;
    DROP TABLE invites;
    DROP TABLE upload_sessions;
    DROP TABLE requests;
    DROP TABLE organization;
    ALTER TABLE session DROP COLUMN activeOrganizationId;
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE operations (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('move', 'delete', 'upload')),
      request_id TEXT,
      upload_id TEXT,
      payload_json TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('prepared', 'assets_moved', 'committed')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX operations_state ON operations(state, created_at);
    CREATE UNIQUE INDEX operations_active_request ON operations(request_id) WHERE request_id IS NOT NULL AND state <> 'committed';
    CREATE UNIQUE INDEX operations_upload ON operations(upload_id) WHERE upload_id IS NOT NULL;
    CREATE TABLE invites (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK (role IN ('admin', 'requester')),
      label TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      used_by TEXT
    );
    CREATE TABLE requests (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      requester_email TEXT NOT NULL,
      requester_name TEXT,
      notes TEXT,
      source_url TEXT,
      thumbnail_path TEXT,
      preview_path TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      assets_generated_at INTEGER,
      printer_id TEXT,
      print_type TEXT CHECK (print_type IN ('resin', 'filament'))
    );
    CREATE INDEX requests_created ON requests(created_at DESC);
    CREATE INDEX requests_print_type ON requests(print_type);
    CREATE INDEX requests_printer_id ON requests(printer_id);
    CREATE TABLE upload_sessions (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      bytes INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL,
      completed_request_id TEXT
    );
    CREATE INDEX upload_sessions_owner ON upload_sessions(owner_id, expires_at);
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
  `)
  if (version === 18) {
    database.exec('DROP TABLE twoFactor; ALTER TABLE "user" DROP COLUMN "twoFactorEnabled"')
  }
  initialized.database.run(drizzleSql`PRAGMA foreign_keys = ON`)
  const record = database.prepare('INSERT INTO schema_migrations VALUES (?,?)')
  for (let applied = 1; applied <= version; applied += 1) record.run(applied, Date.now())
  return database
}

describe('SqliteRepository contract', () => {
  let repository: SqliteRepository

  beforeEach(() => {
    repository = new SqliteRepository(createDatabase(':memory:'))
    insertUser(repository, { id: 'maker', name: 'Maker', email: 'maker@example.com' })
    insertUser(repository, { id: 'other', name: 'Other', email: 'other@example.com' })
    insertUser(repository, { id: 'owner', name: 'Owner', email: 'owner@example.com' })
    insertUser(repository, { id: 'attacker', name: 'Attacker', email: 'attacker@example.com' })
  })
  afterEach(() => repository.close())

  it('persists requests and tracks copy quantities transactionally', () => {
    const id = repository.createRequest({
      name: 'Bracket',
      fileName: 'bracket.stl',
      filePath: 'todo/bracket.stl',
      quantity: 3,
      ownerUserId: 'maker',
      notes: 'PETG',
      sourceUrl: 'https://example.com/bracket',
      printerId: 'printer-id',
    })
    expect(repository.getRequest(id)).toMatchObject({
      counts: { todo: 3, in_progress: 0, done: 0 },
      sourceUrl: 'https://example.com/bracket',
      requestedPrintType: undefined,
      printerId: 'printer-id',
    })

    repository.updateRequest(id, { printerId: 'next-printer' })
    expect(repository.getRequest(id)).toMatchObject({ printerId: 'next-printer' })

    repository.moveCopies({ id, from: 'todo', to: 'in_progress', count: 2, filePath: 'todo/bracket.stl', order: 4 })
    expect(repository.getRequest(id)).toMatchObject({ counts: { todo: 1, in_progress: 2, done: 0 }, orders: { in_progress: 4 } })
    expect(() => repository.moveCopies({ id, from: 'todo', to: 'done', count: 2, filePath: 'todo/bracket.stl' })).toThrow('invalid move')
    expect(repository.getRequest(id)?.counts).toEqual({ todo: 1, in_progress: 2, post_processing: 0, done: 0 })
  })

  it('tracks thumbnail and preview generation as durable stages', () => {
    const id = repository.createRequest({
      name: 'Stages',
      fileName: 'stages.stl',
      filePath: 'todo/stages.stl',
      quantity: 1,
      ownerUserId: 'maker',
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
      ownerUserId: 'maker',
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
      ownerUserId: 'other',
    })
    repository.moveCopies({ id: bracket, from: 'todo', to: 'in_progress', count: 1, filePath: 'todo/bracket.stl' })
    repository.database.update(requests).set({ createdAt: 100, updatedAt: 300 }).where(eq(requests.id, bracket)).run()
    repository.database.update(requests).set({ createdAt: 200, updatedAt: 200 }).where(eq(requests.id, gear)).run()

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

    const result = repository.queryRequests({ filters: { requester: 'maker' } })
    expect(result.facets).toMatchObject({ total: 1, available: 2 })
    expect(result.facets.requesters).toEqual([
      { value: 'maker', label: 'Maker', count: 1 },
      { value: 'other', label: 'Other', count: 1 },
    ])
  })

  it('keeps requesters with duplicate display names distinct', () => {
    insertUser(repository, { id: 'alex-1', name: 'Alex', email: 'alex-1@example.com' })
    insertUser(repository, { id: 'alex-2', name: 'Alex', email: 'alex-2@example.com' })
    for (const ownerUserId of ['alex-1', 'alex-2']) {
      repository.createRequest({
        name: ownerUserId,
        fileName: `${ownerUserId}.stl`,
        filePath: `todo/${ownerUserId}.stl`,
        quantity: 1,
        ownerUserId,
      })
    }

    expect(repository.queryRequests().facets.requesters.filter(({ label }) => label === 'Alex')).toEqual([
      { value: 'alex-1', label: 'Alex', count: 1 },
      { value: 'alex-2', label: 'Alex', count: 1 },
    ])
    expect(repository.queryRequests({ filters: { requester: 'alex-2' } }).requests.map(({ ownerUserId }) => ownerUserId)).toEqual([
      'alex-2',
    ])
  })

  it('filters mixed requests by print type and printer assignment', () => {
    const resin = repository.createRequest({
      name: 'Resin model',
      fileName: 'resin.stl',
      filePath: 'todo/resin.stl',
      quantity: 1,
      ownerUserId: 'maker',
      printerId: 'resin-printer',
    })
    const filament = repository.createRequest({
      name: 'Filament model',
      fileName: 'filament.stl',
      filePath: 'todo/filament.stl',
      quantity: 1,
      ownerUserId: 'maker',
      printerId: 'filament-printer',
    })
    const unassigned = repository.createRequest({
      name: 'Unassigned filament model',
      fileName: 'unassigned.stl',
      filePath: 'todo/unassigned.stl',
      quantity: 1,
      ownerUserId: 'maker',
      requestedPrintType: 'filament',
    })

    repository.setSetting('plate-planner-profiles', [
      {
        id: 'resin-printer',
        name: 'Resin printer',
        printType: 'resin',
        enabled: true,
        widthMm: 100,
        depthMm: 60,
        heightMm: 150,
        spacingMm: 2,
        supportMarginMm: 2,
        adhesionMarginMm: 1,
        heightAllowanceMm: 4,
        maxHeightDifferenceMm: 20,
      },
      {
        id: 'filament-printer',
        name: 'Filament printer',
        printType: 'filament',
        enabled: true,
        widthMm: 220,
        depthMm: 220,
        heightMm: 250,
        spacingMm: 3,
        brimMarginMm: 2,
        filamentDiameterMm: 1.75,
        materialDensityGPerCm3: 1.24,
      },
    ])

    expect(
      repository
        .queryRequests({ filters: { printType: 'filament' } })
        .requests.map(({ id }) => id)
        .sort(),
    ).toEqual([unassigned, filament].sort())
    expect(repository.queryRequests({ filters: { printerId: 'resin-printer' } }).requests.map(({ id }) => id)).toEqual([resin])
    expect(repository.queryRequests({ filters: { printerId: null } }).requests.map(({ id }) => id)).toEqual([unassigned])
  })

  it('applies visibility and ownership before returning requests or facets', () => {
    insertUser(repository, { id: 'me', name: 'Me', email: 'me@example.com' })
    insertUser(repository, { id: 'them', name: 'Them', email: 'them@example.com' })
    repository.createRequest({
      name: 'Mine',
      fileName: 'mine.stl',
      filePath: 'todo/mine.stl',
      quantity: 1,
      ownerUserId: 'me',
    })
    repository.createRequest({
      name: 'Theirs',
      fileName: 'theirs.stl',
      filePath: 'todo/theirs.stl',
      quantity: 1,
      ownerUserId: 'them',
    })
    const privateResult = repository.queryRequests({ visibleToUserId: 'me' })
    expect(privateResult.requests.map((request) => request.name)).toEqual(['Mine'])
    expect(privateResult.facets).toMatchObject({ total: 1, available: 1 })
    expect(repository.queryRequests({ ownerUserId: 'me' }).requests.map((request) => request.name)).toEqual(['Mine'])

    repository.database.update(user).set({ name: 'Renamed' }).where(eq(user.id, 'me')).run()
    expect(repository.queryRequests({ ownerUserId: 'me' }).requests[0]).toMatchObject({ ownerName: 'Renamed' })

    expect(() => repository.database.delete(user).where(eq(user.id, 'me')).run()).toThrow('FOREIGN KEY constraint failed')
    expect(repository.listRequests().find((request) => request.name === 'Mine')).toMatchObject({
      ownerUserId: 'me',
      ownerName: 'Renamed',
    })
  })

  it('only searches private file and email metadata when enabled', () => {
    repository.createRequest({
      name: 'Model',
      fileName: 'private-file.stl',
      filePath: 'todo/model.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    expect(repository.queryRequests({ filters: { query: 'private-file' } }).requests).toHaveLength(0)
    expect(repository.queryRequests({ filters: { query: 'maker@example.com' }, searchPrivateMetadata: true }).requests).toHaveLength(1)
  })

  it('enforces quantity invariants and cascades status deletion', () => {
    const id = repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 2,
      ownerUserId: 'maker',
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

  it('cascades completed upload receipts when deleting their request', () => {
    const id = repository.createRequest({
      name: 'Uploaded gear',
      fileName: 'uploaded-gear.stl',
      filePath: 'todo/uploaded-gear.stl',
      quantity: 1,
      ownerUserId: 'owner',
    })
    repository.createUploadSession('completed-upload', 'owner', Date.now() + 60_000, 3)
    repository.database.update(uploadSessions).set({ completedRequestId: id }).where(eq(uploadSessions.id, 'completed-upload')).run()

    repository.deleteRequest(id)

    expect(repository.database.select().from(uploadSessions).where(eq(uploadSessions.id, 'completed-upload')).get()).toBeUndefined()
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
      ownerUserId: 'maker',
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
        estimatedVolumeMm3: 1_000,
        orientationCandidates: [expect.objectContaining({ islandCount: 0, supportAreaMm2: 20 })],
      }),
    ])
    expect(repository.getRequest(id)).toMatchObject({ estimatedVolumeMm3: 1_000 })
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
    expect(repository.database.get<{ journal_mode: string }>(drizzleSql`PRAGMA journal_mode`)?.journal_mode).toBe('memory')
    expect(repository.database.get<{ synchronous: number }>(drizzleSql`PRAGMA synchronous`)?.synchronous).toBe(2)
    expect(repository.database.get<{ foreign_keys: number }>(drizzleSql`PRAGMA foreign_keys`)?.foreign_keys).toBe(1)
    expect(repository.database.get<{ timeout: number }>(drizzleSql`PRAGMA busy_timeout`)?.timeout).toBe(5000)
    expect(repository.database.get(drizzleSql`SELECT name FROM sqlite_master WHERE type='table' AND name='rateLimit'`)).toEqual({
      name: 'rateLimit',
    })
  })

  it('creates a consistent online backup', async () => {
    const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-backup-'))
    const source = path.join(temporary, 'source.sqlite')
    const destination = path.join(temporary, 'backups', 'copy.sqlite')
    const persisted = SqliteRepository.open(source)
    try {
      insertUser(persisted, { id: 'maker', name: 'Maker', email: 'maker@example.com' })
      const id = persisted.createRequest({
        name: 'Backup probe',
        fileName: 'probe.stl',
        filePath: 'todo/probe.stl',
        quantity: 1,
        ownerUserId: 'maker',
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
    repository.database.delete(user).run()
    insertUser(repository, { id: 'u1', name: 'Maker', email: 'maker@example.com', color: '#fa0' })
    insertUser(repository, { id: 'u2', name: 'Zed', email: 'zed@example.com', role: 'admin' })
    expect(repository.listUsers()).toEqual([
      { id: 'u2', email: 'zed@example.com', name: 'Zed', image: undefined, role: 'admin', workspaceRole: 'admin' },
      { id: 'u1', email: 'maker@example.com', name: 'Maker', image: undefined, role: 'requester', workspaceRole: 'member' },
    ])
    expect(repository.listPeople()).toEqual([
      { id: 'u1', name: 'Maker', color: '#fa0' },
      { id: 'u2', name: 'Zed', color: undefined },
    ])
    expect(repository.countUsers()).toBe(2)
  })

  it('isolates workspace requests, settings, uploads, and members', () => {
    const primary = repository.scoped('test-workspace')
    const secondaryWorkspace = repository.createWorkspace({ id: 'owner' }, 'Second farm')
    const secondary = repository.scoped(secondaryWorkspace.id)
    const primaryRequest = primary.createRequest({
      name: 'Primary model',
      fileName: 'primary.stl',
      filePath: 'todo/primary.stl',
      quantity: 1,
      ownerUserId: 'owner',
    })
    const secondaryRequest = secondary.createRequest({
      name: 'Secondary model',
      fileName: 'secondary.stl',
      filePath: 'todo/secondary.stl',
      quantity: 1,
      ownerUserId: 'owner',
    })
    primary.setSetting('board', { privateRequests: true })
    secondary.setSetting('board', { privateRequests: false })
    primary.createUploadSession('primary-upload', 'owner', Date.now() + 60_000, 3)
    secondary.createUploadSession('secondary-upload', 'owner', Date.now() + 60_000, 3)

    expect(primary.getRequest(primaryRequest)).toBeTruthy()
    expect(primary.getRequest(secondaryRequest)).toBeUndefined()
    expect(secondary.getRequest(primaryRequest)).toBeUndefined()
    expect(secondary.getRequest(secondaryRequest)).toBeTruthy()
    expect(primary.getSetting('board')).toEqual({ privateRequests: true })
    expect(secondary.getSetting('board')).toEqual({ privateRequests: false })
    expect(primary.uploadIdsOwnedBy('owner')).toEqual(['primary-upload'])
    expect(secondary.uploadIdsOwnedBy('owner')).toEqual(['secondary-upload'])
    expect(secondary.listUsers()).toEqual([expect.objectContaining({ id: 'owner', workspaceRole: 'owner' })])
  })

  it('allows matching workspace names for different owners only', () => {
    const first = repository.createWorkspace({ id: 'owner' }, 'Test farm')
    const second = repository.createWorkspace({ id: 'other' }, 'test farm')

    expect(first.slug).toBe('test-farm')
    expect(second.slug).toBe('test-farm-2')
    expect(() => repository.createWorkspace({ id: 'owner' }, '  TEST FARM  ')).toThrow(expect.objectContaining({ status: 409 }))
  })

  it('provisions one personal workspace per membershipless user', () => {
    const now = new Date()
    repository.database
      .insert(user)
      .values({
        id: 'personal-owner',
        name: 'Personal Owner',
        email: 'personal@example.com',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
        role: 'requester',
      })
      .run()
    repository.addWorkspaceMember('personal-owner', 'member')
    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const first = repository.ensurePersonalWorkspace({ id: 'personal-owner', name: 'Personal Owner' })
      const second = repository.ensurePersonalWorkspace({ id: 'personal-owner', name: 'Personal Owner' })

      expect(second).toEqual(first)
      expect(repository.listWorkspacesForUser('personal-owner')).toEqual([
        expect.objectContaining({ id: first.id, role: 'owner' }),
        expect.objectContaining({ id: 'test-workspace', role: 'member' }),
      ])
    } finally {
      process.env.NODE_ENV = previousNodeEnv
    }
  })

  it('lets an existing matching account accept an emailed invite exactly once', () => {
    const now = new Date()
    repository.database
      .insert(user)
      .values({
        id: 'invitee',
        name: 'Invitee',
        email: 'invitee@example.com',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
        role: 'requester',
      })
      .run()
    repository.createInvite({
      id: 'emailed-invite',
      tokenHash: 'emailed-token',
      role: 'admin',
      recipientEmail: 'invitee@example.com',
      expiresAt: Date.now() + 60_000,
    })

    expect(repository.acceptInviteForUser('emailed-token', Date.now(), { id: 'invitee', email: 'invitee@example.com' })).toBeTruthy()
    expect(repository.acceptInviteForUser('emailed-token', Date.now(), { id: 'invitee', email: 'invitee@example.com' })).toBeUndefined()
    expect(repository.workspaceSlugForInvite('emailed-token', Date.now())).toBe('test-workspace')
    expect(repository.listWorkspacesForUser('invitee')).toEqual([expect.objectContaining({ id: 'test-workspace', role: 'admin' })])
  })

  it('keeps an emailed invite usable after the wrong account tries to accept it', () => {
    const expiresAt = Date.now() + 60_000
    repository.createInvite({
      id: 'bound-invite',
      tokenHash: 'bound-token',
      role: 'requester',
      recipientEmail: 'right@example.com',
      expiresAt,
    })

    expect(() => repository.acceptInviteForUser('bound-token', Date.now(), { id: 'wrong-user', email: 'wrong@example.com' })).toThrow(
      expect.objectContaining({ status: 403 }),
    )
    expect(repository.findInvite('bound-token')).toMatchObject({ usedAt: undefined })
    expect(repository.workspaceSlugForInvite('bound-token', Date.now())).toBe('test-workspace')
  })

  it('persists operation state transitions with the associated metadata commit', () => {
    const id = repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 1,
      ownerUserId: 'maker',
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
      ownerUserId: 'maker',
    })
    repository.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1, filePath: 'in-progress/gear.stl', order: 4 })
    repository.moveCopies({ id, from: 'in_progress', to: 'todo', count: 1, filePath: 'todo/gear.stl', order: 2 })
    repository.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1, filePath: 'in-progress/gear.stl', order: 9 })
    expect(repository.getRequest(id)?.orders).toMatchObject({ todo: undefined, in_progress: 9 })
  })

  it('transfers pre-Drizzle requests and assigns stable owner IDs', () => {
    const database = createPreDrizzleDatabase()
    const now = new Date().toISOString()
    const insertOwner = database.prepare('INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt,role) VALUES (?,?,?,1,?,?,?)')
    insertOwner.run('uploader', 'Uploader', 'uploader@example.com', now, now, 'requester')
    insertOwner.run('owner', 'Actual Owner', 'owner@example.com', now, now, 'requester')
    insertOwner.run('duplicate-1', 'Duplicate', 'duplicate-1@example.com', now, now, 'requester')
    insertOwner.run('duplicate-2', 'Duplicate', 'duplicate-2@example.com', now, now, 'requester')
    const insertRequest = database.prepare(
      'INSERT INTO requests (id,name,file_name,file_path,quantity,requester_email,requester_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
    )
    insertRequest.run('matched', 'Matched', 'matched.stl', 'todo/matched.stl', 1, 'uploader@example.com', ' actual owner ', 1, 1)
    insertRequest.run('ambiguous', 'Ambiguous', 'ambiguous.stl', 'todo/ambiguous.stl', 1, 'uploader@example.com', 'Duplicate', 1, 1)
    insertRequest.run('missing', 'Missing', 'missing.stl', 'todo/missing.stl', 1, 'uploader@example.com', 'Missing', 1, 1)

    const migrated = new SqliteRepository(createDatabase(database))

    expect(database.prepare('SELECT owner_user_id FROM requests WHERE id=?').get('matched')).toEqual({ owner_user_id: 'owner' })
    expect(database.prepare('SELECT owner_user_id FROM requests WHERE id=?').get('ambiguous')).toEqual({ owner_user_id: 'uploader' })
    expect(database.prepare('SELECT owner_user_id FROM requests WHERE id=?').get('missing')).toEqual({ owner_user_id: 'uploader' })
    expect(
      database
        .prepare('PRAGMA table_info(requests)')
        .all()
        .map((column: any) => column.name),
    ).not.toContain('requester_email')
    expect(migrated.getRequest('matched')).toMatchObject({
      ownerUserId: 'owner',
      ownerEmail: 'owner@example.com',
      ownerName: 'Actual Owner',
    })
    migrated.close()
  })

  it('rejects pre-Drizzle requests whose owner has no matching account', () => {
    const database = createPreDrizzleDatabase()
    database
      .prepare('INSERT INTO requests (id,name,file_name,file_path,quantity,requester_email,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run('unmatched-request', 'Unmatched', 'unmatched.stl', 'todo/unmatched.stl', 1, 'missing@example.com', 1, 1)

    expect(() => new SqliteRepository(createDatabase(database))).toThrow(
      'cannot migrate request ownership because these requests have no matching account: unmatched-request (missing@example.com)',
    )
    database.close()
  })

  it('rejects unsupported pre-Drizzle schema versions', () => {
    const database = createPreDrizzleDatabase()
    database.prepare('DELETE FROM schema_migrations WHERE version>=18').run()

    expect(() => new SqliteRepository(createDatabase(database))).toThrow(
      'pre-Drizzle database must be on schema version 18 through 21 (found version 17)',
    )
    database.close()
  })

  it('adds the Better Auth two-factor schema when bootstrapping production version 18', () => {
    const database = createPreDrizzleDatabase(':memory:', 18)
    expect(database.prepare('PRAGMA table_info("user")').all()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'twoFactorEnabled' })]),
    )

    const migrated = new SqliteRepository(createDatabase(database))

    expect(database.prepare('PRAGMA table_info("user")').all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'twoFactorEnabled', notnull: 1 })]),
    )
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='twoFactor'").get()).toEqual({
      name: 'twoFactor',
    })
    migrated.close()
  })

  it('assigns legacy workspace ownership to the oldest user when no admin exists', () => {
    const database = createPreDrizzleDatabase()
    const insert = database.prepare(
      'INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt,role,banned,twoFactorEnabled) VALUES (?,?,?,?,?,?,?,?,?)',
    )
    insert.run('newer', 'Newer', 'newer@example.com', 1, 2, 2, 'requester', 0, 0)
    insert.run('oldest', 'Oldest', 'oldest@example.com', 1, 1, 1, 'requester', 0, 0)

    const migrated = new SqliteRepository(createDatabase(database))

    expect(database.prepare("SELECT userId FROM member WHERE organizationId='legacy-workspace' AND role='owner'").get()).toEqual({
      userId: 'oldest',
    })
    migrated.close()
  })

  it('preserves request child rows while adding workspace scope', () => {
    const database = createPreDrizzleDatabase()
    database
      .prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt,role,banned,twoFactorEnabled) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('owner', 'Owner', 'owner@example.com', 1, 1, 1, 'admin', 0, 0)
    database
      .prepare(
        'INSERT INTO requests (id,name,file_name,file_path,quantity,requester_email,requester_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      )
      .run('request-1', 'Model', 'model.stl', 'todo/model.stl', 1, 'owner@example.com', 'Owner', 1, 1)
    database.prepare('INSERT INTO request_statuses (request_id,status_id,quantity) VALUES (?,?,?)').run('request-1', 'todo', 1)
    database
      .prepare('INSERT INTO asset_generation_jobs (request_id,stage,status,queued_at) VALUES (?,?,?,?)')
      .run('request-1', 'thumbnail', 'pending', 1)

    const migrated = new SqliteRepository(createDatabase(database))

    expect(database.prepare("SELECT quantity FROM request_statuses WHERE request_id='request-1' AND status_id='todo'").get()).toEqual({
      quantity: 1,
    })
    expect(database.prepare("SELECT status FROM asset_generation_jobs WHERE request_id='request-1' AND stage='thumbnail'").get()).toEqual({
      status: 'pending',
    })
    migrated.close()
  })

  it('uses only the Drizzle migration journal for fresh databases', () => {
    const database = new Database(':memory:')
    const migrated = new SqliteRepository(createDatabase(database))

    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()).toBeUndefined()
    expect(database.prepare('SELECT count(*) count FROM __drizzle_migrations').get()).toEqual({ count: 3 })
    migrated.close()
  })

  it('bridges the final pre-Drizzle schema once and creates one pre-migration backup', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-drizzle-bridge-'))
    const file = path.join(directory, 'printhub.sqlite')
    try {
      createPreDrizzleDatabase(file, 18).close()

      SqliteRepository.open(file).close()

      const bridged = new Database(file)
      expect(bridged.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()).toBeUndefined()
      expect(bridged.prepare('SELECT count(*) count FROM __drizzle_migrations').get()).toEqual({ count: 3 })
      bridged.close()
      expect(await fs.promises.readdir(path.join(directory, 'backups'))).toHaveLength(1)

      SqliteRepository.open(file).close()

      expect(await fs.promises.readdir(path.join(directory, 'backups'))).toHaveLength(1)
    } finally {
      await fs.promises.rm(directory, { recursive: true, force: true })
    }
  })

  it('keeps assignments for planning changes while pruning their drafts', () => {
    const resin = {
      id: 'resin-printer',
      name: 'Resin printer',
      printType: 'resin',
      enabled: true,
      widthMm: 100,
      depthMm: 60,
      heightMm: 150,
      spacingMm: 2,
      supportMarginMm: 2,
      adhesionMarginMm: 1,
      heightAllowanceMm: 4,
      maxHeightDifferenceMm: 20,
    } as PrinterProfile
    const filament = {
      id: 'filament-printer',
      name: 'Filament printer',
      printType: 'filament',
      enabled: true,
      widthMm: 220,
      depthMm: 220,
      heightMm: 250,
      spacingMm: 3,
      brimMarginMm: 2,
      filamentDiameterMm: 1.75,
      materialDensityGPerCm3: 1.24,
    } as unknown as PrinterProfile
    repository.setSetting('plate-planner-profiles', [resin, filament])
    const resinRequest = repository.createRequest({
      name: 'Resin',
      fileName: 'resin.stl',
      filePath: 'todo/resin.stl',
      quantity: 1,
      ownerUserId: 'maker',
      printerId: resin.id,
    })
    const filamentRequest = repository.createRequest({
      name: 'Filament',
      fileName: 'filament.stl',
      filePath: 'todo/filament.stl',
      quantity: 1,
      ownerUserId: 'maker',
      printerId: filament.id,
    })
    const draft = (printerId: string): PlatePlannerDraft => ({
      fingerprint: printerId,
      printerId,
      candidates: [],
      placements: [],
      skippedCount: 0,
      savedAt: 1,
    })
    repository.setSetting('plate-planner-drafts', { [resin.id]: draft(resin.id), [filament.id]: draft(filament.id) })

    repository.replacePrinterProfiles([{ ...resin, widthMm: 110 }, filament])

    expect(repository.getRequest(resinRequest)?.printerId).toBe(resin.id)
    expect(repository.getRequest(filamentRequest)?.printerId).toBe(filament.id)
    expect(repository.getSetting<Record<string, PlatePlannerDraft>>('plate-planner-drafts')).toEqual({ [filament.id]: draft(filament.id) })

    expect(repository.replacePrinterProfiles([{ ...filament, id: resin.id, name: 'Converted printer' }, filament])).toEqual({
      reanalyzeRequestIds: [resinRequest],
    })
    expect(repository.getRequest(resinRequest)).toMatchObject({ printerId: resin.id, requestedPrintType: undefined })
    expect(repository.getRequest(filamentRequest)?.printerId).toBe(filament.id)
  })

  it('preserves assignments and planner drafts when a printer is disabled', () => {
    const printer: PrinterProfile = {
      id: 'paused-filament',
      name: 'Paused filament printer',
      printType: 'filament',
      enabled: true,
      widthMm: 220,
      depthMm: 220,
      heightMm: 250,
      spacingMm: 3,
      brimMarginMm: 2,
      filamentDiameterMm: 1.75,
      materialDensityGPerCm3: 1.24,
    }
    const draft: PlatePlannerDraft = {
      fingerprint: printer.id,
      printerId: printer.id,
      candidates: [],
      placements: [],
      skippedCount: 0,
      savedAt: 1,
    }
    repository.setSetting('plate-planner-profiles', [printer])
    repository.setSetting('plate-planner-drafts', { [printer.id]: draft })
    const request = repository.createRequest({
      name: 'Assigned model',
      fileName: 'assigned.stl',
      filePath: 'todo/assigned.stl',
      quantity: 1,
      ownerUserId: 'maker',
      printerId: printer.id,
    })

    expect(repository.replacePrinterProfiles([{ ...printer, enabled: false }])).toEqual({ reanalyzeRequestIds: [] })

    expect(repository.getRequest(request)).toMatchObject({ printerId: printer.id, requestedPrintType: undefined })
    expect(repository.getSetting<Record<string, PlatePlannerDraft>>('plate-planner-drafts')).toEqual({ [printer.id]: draft })
  })

  it('moves requests from a deleted printer into its same-type pool', () => {
    const printer: PrinterProfile = {
      id: 'retired-filament',
      name: 'Retired filament printer',
      printType: 'filament',
      enabled: true,
      widthMm: 220,
      depthMm: 220,
      heightMm: 250,
      spacingMm: 3,
      brimMarginMm: 2,
      filamentDiameterMm: 1.75,
      materialDensityGPerCm3: 1.24,
    }
    repository.setSetting('plate-planner-profiles', [printer])
    const request = repository.createRequest({
      name: 'Assigned model',
      fileName: 'assigned.stl',
      filePath: 'todo/assigned.stl',
      quantity: 1,
      ownerUserId: 'maker',
      printerId: printer.id,
    })

    repository.replacePrinterProfiles([])

    expect(repository.getRequest(request)).toMatchObject({ printerId: undefined, requestedPrintType: 'filament' })
  })

  it('reconciles added statuses and rejects removed statuses that contain copies', () => {
    const id = repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    repository.database
      .delete(requestStatuses)
      .where(and(eq(requestStatuses.requestId, id), eq(requestStatuses.statusId, 'done')))
      .run()
    repository.reconcileWorkflow()
    expect(repository.getRequest(id)?.counts.done).toBe(0)
    repository.database.insert(requestStatuses).values({ requestId: id, statusId: 'retired', quantity: 1 }).run()
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
    expect(() => repository.database.delete(user).where(eq(user.id, 'owner')).run()).toThrow('FOREIGN KEY constraint failed')
  })

  it('atomically reserves a request against overlapping durable operations', () => {
    const id = repository.createRequest({
      name: 'Gear',
      fileName: 'gear.stl',
      filePath: 'todo/gear.stl',
      quantity: 1,
      ownerUserId: 'maker',
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
    expect(
      repository.database.select({ count: count() }).from(uploadSessions).where(eq(uploadSessions.ownerId, 'owner')).get()?.count,
    ).toBe(3)
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
    insertUser(first, { id: 'owner', name: 'Owner', email: 'owner@example.com' })
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
