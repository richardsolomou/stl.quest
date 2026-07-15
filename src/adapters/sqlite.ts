import { and, asc, count, desc, eq, getTableColumns, gt, gte, inArray, isNotNull, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm'
import fs from 'node:fs'
import path from 'node:path'
import type {
  NewPrintRequest,
  OperationPayload,
  PrintRequest,
  Repository,
  RequestFilters,
  RequestQuery,
  Role,
  UploadOperation,
} from '../core/types'
import { initialStatus, workflow } from '../core/workflow'
import { normalizePrinterProfile, type PlatePlannerDraft, type PrinterProfile } from '../core/platePlanner'
import { backupDatabase } from './sqliteBackup'
import { closeDatabase, databaseFile, openDatabase, type PrintHubDatabase } from '../db'
import { migrateDatabase } from '../db/migrations'
import {
  assetGenerationJobs,
  invites,
  operations,
  orientationAnalysisJobs,
  plateModelAnalysis,
  requests,
  requestStatuses,
  settings,
  uploadSessions,
  user,
} from '../db/schema'

type RequestRow = typeof requests.$inferSelect & { ownerEmail: string; ownerName: string; estimatedVolumeMm3: number | null }

type SqlFilterOptions = { omitRequester?: boolean; includeOwner?: boolean }

type AssetGenerationJobRow = typeof assetGenerationJobs.$inferSelect

type DatabaseTransaction = Parameters<Parameters<PrintHubDatabase['transaction']>[0]>[0]
type DatabaseExecutor = PrintHubDatabase | DatabaseTransaction

const requestSelection = {
  ...getTableColumns(requests),
  ownerEmail: user.email,
  ownerName: user.name,
  estimatedVolumeMm3: plateModelAnalysis.estimatedVolumeMm3,
}

function mapAssetGenerationJob(job: AssetGenerationJobRow): import('../core/types').AssetGenerationJob {
  return {
    requestId: job.requestId,
    stage: job.stage,
    status: job.status,
    error: job.error ?? undefined,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt ?? undefined,
    finishedAt: job.finishedAt ?? undefined,
  }
}

function mapPlateModelAnalysis(analysis: typeof plateModelAnalysis.$inferSelect): import('../core/platePlanner').PlateModelAnalysis {
  return {
    requestId: analysis.requestId,
    widthMm: analysis.widthMm,
    depthMm: analysis.depthMm,
    heightMm: analysis.heightMm,
    orientationQuaternion: analysis.orientationQuaternion
      ? (JSON.parse(analysis.orientationQuaternion) as [number, number, number, number])
      : undefined,
    orientationIslandCount: analysis.orientationIslandCount ?? undefined,
    orientationRisk: analysis.orientationRisk ?? undefined,
    orientationCandidates: analysis.orientationCandidates
      ? (JSON.parse(analysis.orientationCandidates) as import('../core/mesh/resinOrientation').ResinOrientation[])
      : undefined,
    contentHash: analysis.contentHash ?? undefined,
    analysisVersion: analysis.analysisVersion,
    estimatedVolumeMm3: analysis.estimatedVolumeMm3 ?? undefined,
  }
}

const ORDER_BY: Record<NonNullable<RequestFilters['sort']>, SQL[]> = {
  board: [desc(requests.createdAt)],
  'updated-desc': [desc(requests.updatedAt), desc(requests.createdAt)],
  'updated-asc': [asc(requests.updatedAt), asc(requests.createdAt)],
  'created-desc': [desc(requests.createdAt)],
  'created-asc': [asc(requests.createdAt)],
  'name-asc': [sql`${requests.name} COLLATE NOCASE ASC`, desc(requests.createdAt)],
  'name-desc': [sql`${requests.name} COLLATE NOCASE DESC`, desc(requests.createdAt)],
  'quantity-desc': [desc(requests.quantity), desc(requests.createdAt)],
  'quantity-asc': [asc(requests.quantity), desc(requests.createdAt)],
}

function requestOrderBy(sort: RequestFilters['sort']) {
  return ORDER_BY[sort ?? 'board']
}

function escapeLike(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

export class SqliteRepository implements Repository {
  readonly database: PrintHubDatabase
  private lastIntegrity = { integrity: 'unknown', checkedAt: 0 }

  constructor(database: PrintHubDatabase) {
    this.database = database
    this.database.run(sql`PRAGMA journal_mode = WAL`)
    this.database.run(sql`PRAGMA synchronous = FULL`)
    this.database.run(sql`PRAGMA foreign_keys = ON`)
    this.database.run(sql`PRAGMA busy_timeout = 5000`)
    migrateDatabase(this.database, () => this.backupBeforeMigration())
    this.maintain()
  }

  static open(file = databasePath()) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    return new SqliteRepository(openDatabase(file))
  }

  close() {
    closeDatabase(this.database)
  }

  databaseInfo() {
    const file = databaseFile(this.database)
    const sizeBytes = file && file !== ':memory:' ? fs.statSync(file).size : 0
    return { path: file, sizeBytes, integrity: this.lastIntegrity.integrity, lastCheckedAt: this.lastIntegrity.checkedAt }
  }

  maintain() {
    const result = this.database.get<{ quick_check: string }>(sql`PRAGMA quick_check`)
    const integrity = result?.quick_check ?? 'unknown'
    if (integrity !== 'ok') throw new Error(`database integrity check failed: ${integrity}`)
    this.database.run(sql`PRAGMA optimize`)
    this.database.run(sql`PRAGMA wal_checkpoint(PASSIVE)`)
    this.lastIntegrity = { integrity, checkedAt: Date.now() }
    return { integrity, checkedAt: this.lastIntegrity.checkedAt }
  }

  async backup(destination: string) {
    return backupDatabase(this.database, destination)
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
    this.database.run(sql`VACUUM INTO ${path.join(directory, `printhub-pre-migration-${timestamp}.sqlite`)}`)
  }

  listRequests() {
    const rows = this.database
      .select(requestSelection)
      .from(requests)
      .innerJoin(user, eq(user.id, requests.ownerUserId))
      .leftJoin(plateModelAnalysis, eq(plateModelAnalysis.requestId, requests.id))
      .orderBy(desc(requests.createdAt))
      .all()
    return this.hydrateRows(rows)
  }

  queryRequests(query: RequestQuery = {}) {
    const filters = query.filters ?? {}
    const rows = this.database
      .select(requestSelection)
      .from(requests)
      .innerJoin(user, eq(user.id, requests.ownerUserId))
      .leftJoin(plateModelAnalysis, eq(plateModelAnalysis.requestId, requests.id))
      .where(this.requestConditions(filters, query))
      .orderBy(...requestOrderBy(filters.sort))
      .all()

    const requesters = this.database
      .select({ value: user.id, label: user.name, count: count() })
      .from(requests)
      .innerJoin(user, eq(user.id, requests.ownerUserId))
      .where(this.requestConditions(filters, query, { omitRequester: true }))
      .groupBy(user.id, user.name)
      .orderBy(sql`${user.name} COLLATE NOCASE`, user.id)
      .all()

    const available = this.database
      .select({ count: count() })
      .from(requests)
      .innerJoin(user, eq(user.id, requests.ownerUserId))
      .where(this.requestConditions({}, query, { includeOwner: false }))
      .get()

    return {
      requests: this.hydrateRows(rows),
      facets: {
        requesters,
        total: rows.length,
        available: available?.count ?? 0,
      },
    }
  }

  getRequest(id: string) {
    return this.getRequestFrom(this.database, id)
  }

  private getRequestFrom(database: DatabaseExecutor, id: string) {
    const row = database
      .select(requestSelection)
      .from(requests)
      .innerJoin(user, eq(user.id, requests.ownerUserId))
      .leftJoin(plateModelAnalysis, eq(plateModelAnalysis.requestId, requests.id))
      .where(eq(requests.id, id))
      .get()
    return row ? this.hydrate(database, row) : undefined
  }

  createRequest(request: NewPrintRequest) {
    const id = crypto.randomUUID()
    this.database.transaction((tx) => this.insertRequest(tx, id, request))
    return id
  }

  createUploadSession(uploadId: string, ownerId: string, expiresAt: number, maxIncomplete: number) {
    return this.database.transaction((tx) => {
      const existing = tx
        .select({ ownerId: uploadSessions.ownerId, completedRequestId: uploadSessions.completedRequestId })
        .from(uploadSessions)
        .where(eq(uploadSessions.id, uploadId))
        .get()
      if (existing) {
        if (existing.ownerId !== ownerId) throw new Response('upload id belongs to another user', { status: 409 })
        tx.update(uploadSessions)
          .set({ expiresAt })
          .where(and(eq(uploadSessions.id, uploadId), isNull(uploadSessions.completedRequestId)))
          .run()
        return { fresh: false, completedRequestId: existing.completedRequestId ?? undefined }
      }
      const active = tx
        .select({ count: count() })
        .from(uploadSessions)
        .where(
          and(
            eq(uploadSessions.ownerId, ownerId),
            isNull(uploadSessions.completedRequestId),
            gt(uploadSessions.bytes, 0),
            gt(uploadSessions.expiresAt, Date.now()),
          ),
        )
        .get()?.count
      if ((active ?? 0) >= maxIncomplete) throw new Response('too many incomplete uploads', { status: 429 })
      tx.insert(uploadSessions).values({ id: uploadId, ownerId, expiresAt }).run()
      return { fresh: true }
    })
  }

  reserveUpload(uploadId: string, ownerId: string, bytes: number, expiresAt: number, limits: { count: number; bytes: number }) {
    return this.database.transaction((tx) => {
      const session = tx.select().from(uploadSessions).where(eq(uploadSessions.id, uploadId)).get()
      if (!session || session.ownerId !== ownerId || session.completedRequestId) return false
      const usage = tx
        .select({ count: count(), bytes: sql<number>`coalesce(sum(${uploadSessions.bytes}),0)` })
        .from(uploadSessions)
        .where(
          and(
            eq(uploadSessions.ownerId, ownerId),
            isNull(uploadSessions.completedRequestId),
            gt(uploadSessions.bytes, 0),
            gt(uploadSessions.expiresAt, Date.now()),
          ),
        )
        .get() ?? { count: 0, bytes: 0 }
      const nextCount = usage.count + (session.bytes > 0 ? 0 : 1)
      if (nextCount > limits.count || usage.bytes - session.bytes + bytes > limits.bytes) {
        if (session.bytes === 0) tx.delete(uploadSessions).where(eq(uploadSessions.id, uploadId)).run()
        return false
      }
      tx.update(uploadSessions).set({ bytes, expiresAt }).where(eq(uploadSessions.id, uploadId)).run()
      return true
    })
  }

  expireUploads(now: number) {
    return this.database.transaction((tx) => {
      const expired = and(isNull(uploadSessions.completedRequestId), lte(uploadSessions.expiresAt, now))
      const ids = tx
        .select({ id: uploadSessions.id })
        .from(uploadSessions)
        .where(expired)
        .all()
        .map(({ id }) => id)
      tx.delete(uploadSessions).where(expired).run()
      return ids
    })
  }

  activeUploadIds(now: number) {
    return new Set(
      this.database
        .select({ id: uploadSessions.id })
        .from(uploadSessions)
        .where(and(isNull(uploadSessions.completedRequestId), gt(uploadSessions.bytes, 0), gt(uploadSessions.expiresAt, now)))
        .all()
        .map(({ id }) => id),
    )
  }

  incompleteUploadStats(now: number) {
    return (
      this.database
        .select({ count: count(), bytes: sql<number>`coalesce(sum(${uploadSessions.bytes}),0)` })
        .from(uploadSessions)
        .where(and(isNull(uploadSessions.completedRequestId), gt(uploadSessions.bytes, 0), gt(uploadSessions.expiresAt, now)))
        .get() ?? { count: 0, bytes: 0 }
    )
  }

  uploadIdsOwnedBy(ownerId: string) {
    return this.database
      .select({ id: uploadSessions.id })
      .from(uploadSessions)
      .where(eq(uploadSessions.ownerId, ownerId))
      .all()
      .map(({ id }) => id)
  }

  deleteUploadSessions(ownerId: string) {
    this.database.delete(uploadSessions).where(eq(uploadSessions.ownerId, ownerId)).run()
  }

  getCompletedUpload(uploadId: string, ownerId: string) {
    return (
      this.database
        .select({ id: uploadSessions.completedRequestId })
        .from(uploadSessions)
        .where(and(eq(uploadSessions.id, uploadId), eq(uploadSessions.ownerId, ownerId)))
        .get()?.id ?? undefined
    )
  }

  moveCopies(
    input: { id: string; from: string; to: string; count: number; filePath: string; order?: number },
    database?: DatabaseExecutor,
  ) {
    if (database) return this.moveCopiesWith(database, input)
    this.database.transaction((tx) => this.moveCopiesWith(tx, input))
  }

  reorderRequest(id: string, status: string, order: number) {
    this.database
      .update(requestStatuses)
      .set({ sortOrder: order })
      .where(and(eq(requestStatuses.requestId, id), eq(requestStatuses.statusId, status)))
      .run()
  }

  updateRequest(
    id: string,
    fields: {
      name?: string
      quantity?: number
      notes?: string
      sourceUrl?: string
      requestedPrintType?: import('../core/types').PrintType | null
      printerId?: string | null
    },
  ) {
    this.database.transaction((tx) => {
      const active = tx
        .select({ id: operations.id })
        .from(operations)
        .where(and(eq(operations.requestId, id), ne(operations.state, 'committed')))
        .limit(1)
        .get()
      if (active) throw new Response('another operation is already running for this request', { status: 409 })
      const request = this.getRequestFrom(tx, id)
      if (!request) throw new Error('not found')
      if (fields.quantity !== undefined) {
        const started = workflow.statuses.slice(1).reduce((sum, status) => sum + (request.counts[status.id] ?? 0), 0)
        if (fields.quantity < Math.max(started, 1)) throw new Error('cannot reduce below started copies')
        tx.update(requestStatuses)
          .set({ quantity: fields.quantity - started })
          .where(and(eq(requestStatuses.requestId, id), eq(requestStatuses.statusId, initialStatus().id)))
          .run()
      }
      tx.update(requests)
        .set({
          name: fields.name ?? request.name,
          quantity: fields.quantity ?? request.quantity,
          notes: fields.notes ?? request.notes ?? null,
          sourceUrl: fields.sourceUrl ?? request.sourceUrl ?? null,
          printType: fields.requestedPrintType === undefined ? (request.requestedPrintType ?? null) : fields.requestedPrintType,
          printerId: fields.printerId === undefined ? (request.printerId ?? null) : fields.printerId,
          updatedAt: Date.now(),
        })
        .where(eq(requests.id, id))
        .run()
    })
  }

  deleteRequest(id: string, database: DatabaseExecutor = this.database) {
    database.delete(requests).where(eq(requests.id, id)).run()
  }

  requestsNeedingAssets() {
    return this.database
      .selectDistinct({ id: requests.id })
      .from(requests)
      .innerJoin(assetGenerationJobs, eq(assetGenerationJobs.requestId, requests.id))
      .where(inArray(assetGenerationJobs.status, ['pending', 'running']))
      .orderBy(requests.createdAt)
      .all()
      .map(({ id }) => id)
  }

  queueAssetGeneration(id: string) {
    const request = this.getRequest(id)
    if (!request) return
    const now = Date.now()
    this.database.transaction((tx) => {
      const jobs: (typeof assetGenerationJobs.$inferInsert)[] = [
        ...(!request.thumbnailPath ? ([{ requestId: id, stage: 'thumbnail', status: 'pending', queuedAt: now }] as const) : []),
        ...(!request.previewPath ? ([{ requestId: id, stage: 'preview', status: 'pending', queuedAt: now }] as const) : []),
      ]
      if (jobs.length) tx.insert(assetGenerationJobs).values(jobs).onConflictDoNothing().run()
      tx.update(requests).set({ assetsGeneratedAt: null }).where(eq(requests.id, id)).run()
    })
  }

  requeueAssetGeneration(id: string, stages: import('../core/types').AssetGenerationStage[]) {
    this.database.transaction((tx) => {
      const now = Date.now()
      tx.update(assetGenerationJobs)
        .set({ status: 'pending', error: null, queuedAt: now, startedAt: null, finishedAt: null })
        .where(and(eq(assetGenerationJobs.requestId, id), inArray(assetGenerationJobs.stage, stages)))
        .run()
      tx.update(requests).set({ assetsGeneratedAt: null }).where(eq(requests.id, id)).run()
    })
  }

  startAssetGeneration(id: string, stages: import('../core/types').AssetGenerationStage[]) {
    this.database
      .update(assetGenerationJobs)
      .set({ status: 'running', startedAt: Date.now(), finishedAt: null, error: null })
      .where(
        and(eq(assetGenerationJobs.requestId, id), inArray(assetGenerationJobs.stage, stages), eq(assetGenerationJobs.status, 'pending')),
      )
      .run()
  }

  finishAssetGeneration(
    id: string,
    stage: import('../core/types').AssetGenerationStage,
    outcome: { status: 'ready' | 'skipped' | 'failed'; path?: string; error?: string },
  ) {
    this.database.transaction((tx) => {
      const now = Date.now()
      tx.update(assetGenerationJobs)
        .set({ status: outcome.status, error: outcome.error?.slice(0, 1_000) ?? null, finishedAt: now })
        .where(and(eq(assetGenerationJobs.requestId, id), eq(assetGenerationJobs.stage, stage)))
        .run()
      if (outcome.path) {
        tx.update(requests)
          .set(stage === 'thumbnail' ? { thumbnailPath: outcome.path, updatedAt: now } : { previewPath: outcome.path, updatedAt: now })
          .where(eq(requests.id, id))
          .run()
      }
      const unfinished = tx
        .select({ requestId: assetGenerationJobs.requestId })
        .from(assetGenerationJobs)
        .where(and(eq(assetGenerationJobs.requestId, id), inArray(assetGenerationJobs.status, ['pending', 'running'])))
        .limit(1)
        .get()
      if (!unfinished) tx.update(requests).set({ assetsGeneratedAt: now, updatedAt: now }).where(eq(requests.id, id)).run()
    })
  }

  listAssetGenerationJobs() {
    return this.database
      .select()
      .from(assetGenerationJobs)
      .orderBy(assetGenerationJobs.queuedAt, assetGenerationJobs.stage)
      .all()
      .map(mapAssetGenerationJob)
  }

  assetGenerationJobs(id: string) {
    return this.database
      .select()
      .from(assetGenerationJobs)
      .where(eq(assetGenerationJobs.requestId, id))
      .orderBy(assetGenerationJobs.stage)
      .all()
      .map(mapAssetGenerationJob)
  }

  requeueInterruptedAssetGeneration() {
    this.database
      .update(assetGenerationJobs)
      .set({ status: 'pending', queuedAt: Date.now(), startedAt: null, finishedAt: null, error: null })
      .where(eq(assetGenerationJobs.status, 'running'))
      .run()
  }

  requestsNeedingOrientationAnalysis(analysisVersion: number) {
    const profiles = this.getSetting<PrinterProfile[]>('plate-planner-profiles') ?? []
    const resinPrinterIds = profiles.filter((profile) => printerPrintType(profile) === 'resin').map((profile) => profile.id)
    const resinTarget = or(
      and(isNull(requests.printerId), eq(requests.printType, 'resin')),
      resinPrinterIds.length ? inArray(requests.printerId, resinPrinterIds) : undefined,
    )
    return this.database
      .select({ id: requests.id })
      .from(requests)
      .leftJoin(orientationAnalysisJobs, eq(orientationAnalysisJobs.requestId, requests.id))
      .leftJoin(plateModelAnalysis, eq(plateModelAnalysis.requestId, requests.id))
      .where(
        or(
          isNull(orientationAnalysisJobs.requestId),
          ne(orientationAnalysisJobs.analysisVersion, analysisVersion),
          inArray(orientationAnalysisJobs.status, ['pending', 'running']),
          and(
            resinTarget,
            isNotNull(plateModelAnalysis.requestId),
            or(isNull(plateModelAnalysis.orientationCandidates), eq(plateModelAnalysis.orientationCandidates, '[]')),
          ),
        ),
      )
      .orderBy(requests.createdAt)
      .all()
      .map(({ id }) => id)
  }

  queueOrientationAnalysis(id: string, analysisVersion: number) {
    const now = Date.now()
    this.database
      .insert(orientationAnalysisJobs)
      .values({ requestId: id, status: 'pending', analysisVersion, queuedAt: now })
      .onConflictDoUpdate({
        target: orientationAnalysisJobs.requestId,
        set: { status: 'pending', analysisVersion, error: null, queuedAt: now, startedAt: null, finishedAt: null },
        where: or(ne(orientationAnalysisJobs.status, 'ready'), ne(orientationAnalysisJobs.analysisVersion, analysisVersion)),
      })
      .run()
  }

  startOrientationAnalysis(id: string, analysisVersion: number) {
    this.database
      .update(orientationAnalysisJobs)
      .set({ status: 'running', startedAt: Date.now(), finishedAt: null, error: null })
      .where(and(eq(orientationAnalysisJobs.requestId, id), eq(orientationAnalysisJobs.analysisVersion, analysisVersion)))
      .run()
  }

  failOrientationAnalysis(id: string, analysisVersion: number, error: string) {
    this.database
      .update(orientationAnalysisJobs)
      .set({ status: 'failed', error: error.slice(0, 1_000), finishedAt: Date.now() })
      .where(and(eq(orientationAnalysisJobs.requestId, id), eq(orientationAnalysisJobs.analysisVersion, analysisVersion)))
      .run()
  }

  listOrientationAnalysisJobs() {
    return this.database
      .select()
      .from(orientationAnalysisJobs)
      .orderBy(orientationAnalysisJobs.queuedAt)
      .all()
      .map((job) => ({
        requestId: job.requestId,
        status: job.status,
        analysisVersion: job.analysisVersion,
        error: job.error ?? undefined,
        queuedAt: job.queuedAt,
        startedAt: job.startedAt ?? undefined,
        finishedAt: job.finishedAt ?? undefined,
      }))
  }

  completeAssetGeneration(id: string, generated: { thumbnailPath?: string; previewPath?: string }) {
    const now = Date.now()
    this.database.transaction((tx) => {
      tx.update(requests)
        .set({
          ...(generated.thumbnailPath ? { thumbnailPath: generated.thumbnailPath } : {}),
          ...(generated.previewPath ? { previewPath: generated.previewPath } : {}),
          assetsGeneratedAt: now,
          updatedAt: now,
        })
        .where(eq(requests.id, id))
        .run()
      tx.update(assetGenerationJobs)
        .set({ status: generated.thumbnailPath ? 'ready' : 'failed', finishedAt: now })
        .where(and(eq(assetGenerationJobs.requestId, id), eq(assetGenerationJobs.stage, 'thumbnail')))
        .run()
      tx.update(assetGenerationJobs)
        .set({ status: generated.previewPath ? 'ready' : 'skipped', finishedAt: now })
        .where(and(eq(assetGenerationJobs.requestId, id), eq(assetGenerationJobs.stage, 'preview')))
        .run()
    })
  }

  getPlateModelAnalysis(requestId: string) {
    const row = this.database.select().from(plateModelAnalysis).where(eq(plateModelAnalysis.requestId, requestId)).get()
    return row ? mapPlateModelAnalysis(row) : undefined
  }

  listPlateModelAnalyses() {
    return this.database.select().from(plateModelAnalysis).orderBy(plateModelAnalysis.requestId).all().map(mapPlateModelAnalysis)
  }

  upsertPlateModelAnalyses(analyses: import('../core/platePlanner').PlateModelAnalysis[]) {
    this.database.transaction((tx) => {
      const now = Date.now()
      for (const analysis of analyses) {
        const values = {
          requestId: analysis.requestId,
          widthMm: analysis.widthMm,
          depthMm: analysis.depthMm,
          heightMm: analysis.heightMm,
          orientationQuaternion: analysis.orientationQuaternion ? JSON.stringify(analysis.orientationQuaternion) : null,
          orientationIslandCount: analysis.orientationIslandCount ?? null,
          orientationRisk: analysis.orientationRisk ?? null,
          orientationCandidates: analysis.orientationCandidates ? JSON.stringify(analysis.orientationCandidates) : null,
          contentHash: analysis.contentHash ?? null,
          analysisVersion: analysis.analysisVersion ?? 1,
          estimatedVolumeMm3: analysis.estimatedVolumeMm3 ?? analysis.orientationCandidates?.[0]?.estimatedVolumeMm3 ?? null,
          analyzedAt: now,
        }
        tx.insert(plateModelAnalysis).values(values).onConflictDoUpdate({ target: plateModelAnalysis.requestId, set: values }).run()
        tx.insert(orientationAnalysisJobs)
          .values({
            requestId: analysis.requestId,
            status: 'ready',
            analysisVersion: analysis.analysisVersion ?? 1,
            queuedAt: now,
            startedAt: now,
            finishedAt: now,
          })
          .onConflictDoUpdate({
            target: orientationAnalysisJobs.requestId,
            set: { status: 'ready', analysisVersion: analysis.analysisVersion ?? 1, error: null, finishedAt: now },
          })
          .run()
      }
    })
  }

  findPlateModelAnalysisByContentHash(contentHash: string, analysisVersion: number) {
    const row = this.database
      .select()
      .from(plateModelAnalysis)
      .where(and(eq(plateModelAnalysis.contentHash, contentHash), eq(plateModelAnalysis.analysisVersion, analysisVersion)))
      .limit(1)
      .get()
    return row ? mapPlateModelAnalysis(row) : undefined
  }

  listPeople() {
    return this.database
      .select({ id: user.id, name: user.name, color: user.color })
      .from(user)
      .orderBy(user.name, user.id)
      .all()
      .map((row) => ({ id: row.id, name: row.name, color: row.color ?? undefined }))
  }

  listUsers() {
    return this.database
      .select({ id: user.id, email: user.email, name: user.name, image: user.image, role: user.role })
      .from(user)
      .orderBy(sql`CASE ${user.role} WHEN 'admin' THEN 0 ELSE 1 END`, sql`${user.name} COLLATE NOCASE`)
      .all()
      .map((row) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        image: row.image ?? undefined,
        role: row.role === 'admin' ? ('admin' as const) : ('requester' as const),
      }))
  }

  getSetting<T>(key: string): T | undefined {
    return this.getSettingFrom<T>(this.database, key)
  }

  setSetting(key: string, value: unknown) {
    this.setSettingWith(this.database, key, value)
  }

  replacePrinterProfiles(profiles: PrinterProfile[]) {
    return this.database.transaction((tx) => {
      const previous = (this.getSettingFrom<PrinterProfile[]>(tx, 'plate-planner-profiles') ?? []).map(normalizePrinterProfile)
      const next = profiles.map(normalizePrinterProfile)
      const nextById = new Map(next.map((profile) => [profile.id, profile]))
      const changedIds = new Set(
        previous.filter((profile) => plannerProfileChanged(profile, nextById.get(profile.id))).map((profile) => profile.id),
      )

      const reanalyzeRequestIds: string[] = []
      const now = Date.now()
      for (const profile of previous) {
        const replacement = nextById.get(profile.id)
        if (!replacement) {
          tx.update(requests)
            .set({ printerId: null, printType: printerPrintType(profile), updatedAt: now })
            .where(eq(requests.printerId, profile.id))
            .run()
          continue
        }
        if (printerPrintType(profile) !== printerPrintType(replacement)) {
          const assigned = tx.select({ id: requests.id }).from(requests).where(eq(requests.printerId, profile.id)).all()
          reanalyzeRequestIds.push(...assigned.map(({ id }) => id))
        }
      }
      tx.update(requests).set({ printType: null }).where(isNotNull(requests.printerId)).run()

      this.setSettingWith(tx, 'plate-planner-profiles', next)
      const drafts = this.getSettingFrom<Record<string, PlatePlannerDraft>>(tx, 'plate-planner-drafts') ?? {}
      const legacyDraft = this.getSettingFrom<PlatePlannerDraft>(tx, 'plate-planner-draft')
      if (legacyDraft && !drafts[legacyDraft.printerId]) drafts[legacyDraft.printerId] = legacyDraft
      for (const printerId of Object.keys(drafts)) {
        if (!nextById.has(printerId) || changedIds.has(printerId)) delete drafts[printerId]
      }
      this.setSettingWith(tx, 'plate-planner-drafts', drafts)
      tx.delete(settings).where(eq(settings.key, 'plate-planner-draft')).run()
      return { reanalyzeRequestIds }
    })
  }

  countUsers() {
    return this.database.select({ count: count() }).from(user).get()?.count ?? 0
  }

  createInvite(invite: { id: string; tokenHash: string; role: Role; label?: string; expiresAt: number }) {
    this.database
      .insert(invites)
      .values({
        id: invite.id,
        tokenHash: invite.tokenHash,
        role: invite.role,
        label: invite.label,
        createdAt: Date.now(),
        expiresAt: invite.expiresAt,
      })
      .run()
  }

  listInvites() {
    return this.database
      .select()
      .from(invites)
      .orderBy(desc(invites.createdAt))
      .all()
      .map((row) => ({
        id: row.id,
        role: row.role,
        label: row.label ?? undefined,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        usedAt: row.usedAt ?? undefined,
      }))
  }

  findInvite(tokenHash: string) {
    const row = this.database.select().from(invites).where(eq(invites.tokenHash, tokenHash)).get()
    return row
      ? {
          id: row.id,
          role: row.role,
          label: row.label ?? undefined,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
          usedAt: row.usedAt ?? undefined,
        }
      : undefined
  }

  claimInvite(tokenHash: string, now: number) {
    const row = this.database
      .update(invites)
      .set({ usedAt: now })
      .where(and(eq(invites.tokenHash, tokenHash), isNull(invites.usedAt), gt(invites.expiresAt, now)))
      .returning()
      .get()
    return row
      ? {
          id: row.id,
          role: row.role,
          label: row.label ?? undefined,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
          usedAt: row.usedAt!,
        }
      : undefined
  }

  completeInvite(id: string, userId: string) {
    this.database.update(invites).set({ usedBy: userId }).where(eq(invites.id, id)).run()
  }

  deleteInvite(id: string) {
    this.database
      .delete(invites)
      .where(and(eq(invites.id, id), isNull(invites.usedAt)))
      .run()
  }

  beginOperation(id: string, payload: OperationPayload) {
    if (payload.kind === 'upload') return this.beginUploadOperation(id, payload)
    const now = Date.now()
    try {
      this.database
        .insert(operations)
        .values({
          id,
          kind: payload.kind,
          requestId: payload.requestId,
          payloadJson: JSON.stringify(payload),
          state: 'prepared',
          createdAt: now,
          updatedAt: now,
        })
        .run()
    } catch (error) {
      if (sqliteErrorCode(error) === 'SQLITE_CONSTRAINT_UNIQUE')
        throw new Response('another operation is already running for this request', { status: 409 })
      throw error
    }
  }

  beginUploadOperation(id: string, payload: UploadOperation) {
    const now = Date.now()
    this.database.transaction((tx) => {
      const completed = this.getCompletedUploadFrom(tx, payload.uploadId, payload.ownerId)
      if (completed) return
      tx.insert(operations)
        .values({
          id,
          kind: payload.kind,
          requestId: payload.requestId,
          uploadId: payload.uploadId,
          payloadJson: JSON.stringify(payload),
          state: 'prepared',
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run()
    })
  }

  markOperationAssetsMoved(id: string) {
    this.database
      .update(operations)
      .set({ state: 'assets_moved', updatedAt: Date.now() })
      .where(and(eq(operations.id, id), eq(operations.state, 'prepared')))
      .run()
  }

  completeMoveOperation(id: string, input: { id: string; from: string; to: string; count: number; filePath: string; order?: number }) {
    this.database.transaction((tx) => {
      const operation = tx.select({ state: operations.state }).from(operations).where(eq(operations.id, id)).get()
      if (!operation || operation.state === 'committed') return
      this.moveCopies(input, tx)
      tx.update(operations).set({ state: 'committed', updatedAt: Date.now() }).where(eq(operations.id, id)).run()
    })
  }

  completeDeleteOperation(id: string, requestId: string) {
    this.database.transaction((tx) => {
      const operation = tx.select({ state: operations.state }).from(operations).where(eq(operations.id, id)).get()
      if (!operation || operation.state === 'committed') return
      this.deleteRequest(requestId, tx)
      tx.update(operations).set({ state: 'committed', updatedAt: Date.now() }).where(eq(operations.id, id)).run()
    })
  }

  completeUploadOperation(id: string, payload: UploadOperation) {
    return this.database.transaction((tx) => {
      const completed = this.getCompletedUploadFrom(tx, payload.uploadId, payload.ownerId)
      if (completed) return completed
      const operation = tx.select({ state: operations.state }).from(operations).where(eq(operations.id, id)).get()
      if (!operation) throw new Error('upload operation is missing')
      this.insertRequest(tx, payload.requestId, { ...payload.request, filePath: payload.destinationPath })
      tx.update(uploadSessions)
        .set({ completedRequestId: payload.requestId, bytes: 0 })
        .where(and(eq(uploadSessions.id, payload.uploadId), eq(uploadSessions.ownerId, payload.ownerId)))
        .run()
      tx.update(operations).set({ state: 'committed', updatedAt: Date.now() }).where(eq(operations.id, id)).run()
      return payload.requestId
    })
  }

  listOperations() {
    return this.database
      .select({ id: operations.id, state: operations.state, payloadJson: operations.payloadJson })
      .from(operations)
      .orderBy(operations.createdAt)
      .all()
      .map((row) => ({
        id: row.id,
        state: row.state,
        payload: JSON.parse(row.payloadJson) as OperationPayload,
      }))
  }

  finishOperation(id: string) {
    this.database
      .delete(operations)
      .where(and(eq(operations.id, id), eq(operations.state, 'committed')))
      .run()
  }
  abandonOperation(id: string) {
    this.database.delete(operations).where(eq(operations.id, id)).run()
  }

  private hydrate(database: DatabaseExecutor, row: RequestRow): PrintRequest {
    const states = database.select().from(requestStatuses).where(eq(requestStatuses.requestId, row.id)).all()
    return {
      id: row.id,
      name: row.name,
      fileName: row.fileName,
      filePath: row.filePath,
      quantity: row.quantity,
      ownerUserId: row.ownerUserId,
      ownerEmail: row.ownerEmail,
      ownerName: row.ownerName,
      notes: row.notes ?? undefined,
      sourceUrl: row.sourceUrl ?? undefined,
      thumbnailPath: row.thumbnailPath ?? undefined,
      previewPath: row.previewPath ?? undefined,
      requestedPrintType: row.printType ?? undefined,
      printerId: row.printerId ?? undefined,
      hasThumbnail: row.thumbnailPath !== null,
      estimatedVolumeMm3: row.estimatedVolumeMm3 ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      counts: Object.fromEntries(states.map((state) => [state.statusId, state.quantity])),
      orders: Object.fromEntries(states.map((state) => [state.statusId, state.sortOrder ?? undefined])),
    }
  }

  private hydrateRows(rows: RequestRow[]): PrintRequest[] {
    if (rows.length === 0) return []
    const states = this.database
      .select()
      .from(requestStatuses)
      .where(
        inArray(
          requestStatuses.requestId,
          rows.map((row) => row.id),
        ),
      )
      .all()
    const byRequest = new Map<string, typeof states>()
    for (const state of states) {
      const current = byRequest.get(state.requestId) ?? []
      current.push(state)
      byRequest.set(state.requestId, current)
    }
    return rows.map((row) => {
      const requestStates = byRequest.get(row.id) ?? []
      return {
        id: row.id,
        name: row.name,
        fileName: row.fileName,
        filePath: row.filePath,
        quantity: row.quantity,
        ownerUserId: row.ownerUserId,
        ownerEmail: row.ownerEmail,
        ownerName: row.ownerName,
        notes: row.notes ?? undefined,
        sourceUrl: row.sourceUrl ?? undefined,
        thumbnailPath: row.thumbnailPath ?? undefined,
        previewPath: row.previewPath ?? undefined,
        requestedPrintType: row.printType ?? undefined,
        printerId: row.printerId ?? undefined,
        hasThumbnail: row.thumbnailPath !== null,
        estimatedVolumeMm3: row.estimatedVolumeMm3 ?? undefined,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        counts: Object.fromEntries(requestStates.map((state) => [state.statusId, state.quantity])),
        orders: Object.fromEntries(requestStates.map((state) => [state.statusId, state.sortOrder ?? undefined])),
      }
    })
  }

  private requestConditions(filters: RequestFilters, query: RequestQuery, options: SqlFilterOptions = {}) {
    const conditions: SQL[] = []

    if (query.visibleToUserId) conditions.push(eq(requests.ownerUserId, query.visibleToUserId))
    if (options.includeOwner !== false && query.ownerUserId) conditions.push(eq(requests.ownerUserId, query.ownerUserId))
    if (filters.query) {
      const pattern = `%${escapeLike(filters.query.toLowerCase())}%`
      const privateMetadata = query.searchPrivateMetadata ? sql` || ' ' || ${requests.fileName} || ' ' || ${user.email}` : sql``
      conditions.push(
        sql`(lower(${requests.id} || ' ' || ${requests.name}${privateMetadata} || ' ' ||
          ${user.name} || ' ' || coalesce(${requests.notes},'') || ' ' || coalesce(${requests.sourceUrl},'')) LIKE ${pattern} ESCAPE char(92)
          OR EXISTS (SELECT 1 FROM ${requestStatuses} search_status
            WHERE search_status.request_id = ${requests.id} AND search_status.quantity > 0
              AND lower(replace(search_status.status_id, '_', ' ')) LIKE ${pattern} ESCAPE char(92)))`,
      )
    }
    if (filters.requester && !options.omitRequester) {
      conditions.push(eq(requests.ownerUserId, filters.requester))
    }
    if (filters.minQuantity !== undefined) conditions.push(gte(requests.quantity, filters.minQuantity))
    if (filters.maxQuantity !== undefined) conditions.push(lte(requests.quantity, filters.maxQuantity))
    if (filters.createdAfter !== undefined) conditions.push(gte(requests.createdAt, filters.createdAfter))
    if (filters.createdBefore !== undefined) conditions.push(lte(requests.createdAt, filters.createdBefore))
    if (filters.updatedAfter !== undefined) conditions.push(gte(requests.updatedAt, filters.updatedAfter))
    if (filters.updatedBefore !== undefined) conditions.push(lte(requests.updatedAt, filters.updatedBefore))
    if (filters.hasNotes !== undefined)
      conditions.push(filters.hasNotes ? sql`trim(coalesce(${requests.notes},'')) <> ''` : sql`trim(coalesce(${requests.notes},'')) = ''`)
    if (filters.hasSource !== undefined)
      conditions.push(
        filters.hasSource ? sql`trim(coalesce(${requests.sourceUrl},'')) <> ''` : sql`trim(coalesce(${requests.sourceUrl},'')) = ''`,
      )
    if (filters.hasThumbnail !== undefined)
      conditions.push(filters.hasThumbnail ? isNotNull(requests.thumbnailPath) : isNull(requests.thumbnailPath))
    if (filters.hasPreview !== undefined)
      conditions.push(filters.hasPreview ? isNotNull(requests.previewPath) : isNull(requests.previewPath))
    if (filters.printType !== undefined) {
      const profiles = this.getSetting<PrinterProfile[]>('plate-planner-profiles') ?? []
      const printerIds = profiles.filter((profile) => printerPrintType(profile) === filters.printType).map((profile) => profile.id)
      if (printerIds.length) {
        conditions.push(or(eq(requests.printType, filters.printType), inArray(requests.printerId, printerIds))!)
      } else {
        conditions.push(eq(requests.printType, filters.printType))
      }
    }
    if (filters.printerId !== undefined) {
      conditions.push(filters.printerId === null ? isNull(requests.printerId) : eq(requests.printerId, filters.printerId))
    }
    return conditions.length ? and(...conditions) : undefined
  }

  private insertRequest(db: DatabaseExecutor, id: string, request: NewPrintRequest) {
    const now = Date.now()
    db.insert(requests)
      .values({
        id,
        name: request.name,
        fileName: request.fileName,
        filePath: request.filePath,
        quantity: request.quantity,
        ownerUserId: request.ownerUserId,
        notes: request.notes,
        sourceUrl: request.sourceUrl,
        thumbnailPath: request.thumbnailPath,
        previewPath: request.previewPath,
        printType: request.printerId ? null : request.requestedPrintType,
        printerId: request.printerId,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    db.insert(requestStatuses)
      .values(
        workflow.statuses.map((status) => ({
          requestId: id,
          statusId: status.id,
          quantity: status.id === initialStatus().id ? request.quantity : 0,
        })),
      )
      .run()
    db.insert(assetGenerationJobs)
      .values([
        {
          requestId: id,
          stage: 'thumbnail',
          status: request.thumbnailPath ? 'ready' : 'pending',
          queuedAt: now,
          finishedAt: request.thumbnailPath ? now : null,
        },
        {
          requestId: id,
          stage: 'preview',
          status: request.previewPath ? 'ready' : 'pending',
          queuedAt: now,
          finishedAt: request.previewPath ? now : null,
        },
      ])
      .run()
  }

  reconcileWorkflow() {
    this.database.transaction((tx) => {
      const configured = new Set(workflow.statuses.map((status) => status.id))
      const existing = tx.selectDistinct({ statusId: requestStatuses.statusId }).from(requestStatuses).all()
      for (const { statusId } of existing) {
        if (configured.has(statusId)) continue
        const used = tx
          .select({ requestId: requestStatuses.requestId })
          .from(requestStatuses)
          .where(and(eq(requestStatuses.statusId, statusId), gt(requestStatuses.quantity, 0)))
          .limit(1)
          .get()
        if (used) throw new Error(`workflow status ${statusId} still has copies and cannot be removed`)
        tx.delete(requestStatuses).where(eq(requestStatuses.statusId, statusId)).run()
      }
      const requestIds = tx.select({ id: requests.id }).from(requests).all()
      const statuses = requestIds.flatMap(({ id }) =>
        workflow.statuses.map((status) => ({ requestId: id, statusId: status.id, quantity: 0 })),
      )
      if (statuses.length) tx.insert(requestStatuses).values(statuses).onConflictDoNothing().run()
    })
  }

  private getCompletedUploadFrom(db: DatabaseExecutor, uploadId: string, ownerId: string) {
    return (
      db
        .select({ id: uploadSessions.completedRequestId })
        .from(uploadSessions)
        .where(and(eq(uploadSessions.id, uploadId), eq(uploadSessions.ownerId, ownerId)))
        .get()?.id ?? undefined
    )
  }

  private getSettingFrom<T>(db: DatabaseExecutor, key: string): T | undefined {
    const row = db.select({ value: settings.valueJson }).from(settings).where(eq(settings.key, key)).get()
    return row ? (JSON.parse(row.value) as T) : undefined
  }

  private setSettingWith(db: DatabaseExecutor, key: string, value: unknown) {
    const values = { key, valueJson: JSON.stringify(value), updatedAt: Date.now() }
    db.insert(settings).values(values).onConflictDoUpdate({ target: settings.key, set: values }).run()
  }

  private moveCopiesWith(
    db: DatabaseExecutor,
    input: { id: string; from: string; to: string; count: number; filePath: string; order?: number },
  ) {
    const from = db
      .select({ quantity: requestStatuses.quantity })
      .from(requestStatuses)
      .where(and(eq(requestStatuses.requestId, input.id), eq(requestStatuses.statusId, input.from)))
      .get()
    if (!from || from.quantity < input.count) throw new Error('invalid move')
    const target = db
      .select({ quantity: requestStatuses.quantity })
      .from(requestStatuses)
      .where(and(eq(requestStatuses.requestId, input.id), eq(requestStatuses.statusId, input.to)))
      .get()
    if (!target) throw new Error('invalid target status')
    db.update(requestStatuses)
      .set({
        quantity: sql`${requestStatuses.quantity} - ${input.count}`,
        sortOrder: sql`CASE WHEN ${requestStatuses.quantity} - ${input.count} = 0 THEN NULL ELSE ${requestStatuses.sortOrder} END`,
      })
      .where(and(eq(requestStatuses.requestId, input.id), eq(requestStatuses.statusId, input.from)))
      .run()
    db.update(requestStatuses)
      .set({
        quantity: sql`${requestStatuses.quantity} + ${input.count}`,
        sortOrder: sql`CASE WHEN ${requestStatuses.quantity} = 0 THEN ${input.order ?? null} ELSE ${requestStatuses.sortOrder} END`,
      })
      .where(and(eq(requestStatuses.requestId, input.id), eq(requestStatuses.statusId, input.to)))
      .run()
    db.update(requests).set({ filePath: input.filePath, updatedAt: Date.now() }).where(eq(requests.id, input.id)).run()
  }
}

function sqliteErrorCode(error: unknown): string | undefined {
  let current = error
  while (current && typeof current === 'object') {
    if ('code' in current && typeof current.code === 'string') return current.code
    current = 'cause' in current ? current.cause : undefined
  }
  return undefined
}

function printerPrintType(printer: PrinterProfile): import('../core/types').PrintType {
  return normalizePrinterProfile(printer).printType
}

function plannerProfileChanged(previous: PrinterProfile, next?: PrinterProfile) {
  if (!next) return true
  const { enabled: _previousEnabled, ...previousPlanning } = previous
  const { enabled: _nextEnabled, ...nextPlanning } = next
  return JSON.stringify(previousPlanning) !== JSON.stringify(nextPlanning)
}

export function databasePath() {
  return path.join(path.resolve(process.env.DATA_DIR ?? '/data'), 'printhub.sqlite')
}
