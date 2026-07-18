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
  deploymentSettings,
  invites,
  invitation,
  member,
  operations,
  organization,
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
  readonly workspaceId?: string
  private readonly ownsDatabase: boolean
  private lastIntegrity = { integrity: 'unknown', checkedAt: 0 }

  constructor(database: PrintHubDatabase, options: { workspaceId?: string; initialize?: boolean; ownsDatabase?: boolean } = {}) {
    this.database = database
    this.workspaceId = options.workspaceId
    this.ownsDatabase = options.ownsDatabase ?? true
    if (options.initialize === false) return
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

  scoped(workspaceId: string) {
    return new SqliteRepository(this.database, { workspaceId, initialize: false, ownsDatabase: false })
  }

  private workspace() {
    if (this.workspaceId) return this.workspaceId
    const existing = this.database.select({ id: organization.id }).from(organization).orderBy(organization.createdAt).limit(1).get()?.id
    if (existing) return existing
    if (process.env.NODE_ENV !== 'test') throw new Error('workspace-scoped repository required')
    const id = 'test-workspace'
    this.database.insert(organization).values({ id, name: 'Test workspace', slug: id, createdAt: new Date() }).onConflictDoNothing().run()
    return id
  }

  close() {
    if (this.ownsDatabase) closeDatabase(this.database)
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
    const workspaceId = this.workspace()
    const rows = this.database
      .select(requestSelection)
      .from(requests)
      .innerJoin(user, eq(user.id, requests.ownerUserId))
      .leftJoin(
        plateModelAnalysis,
        and(eq(plateModelAnalysis.workspaceId, requests.workspaceId), eq(plateModelAnalysis.requestId, requests.id)),
      )
      .where(eq(requests.workspaceId, workspaceId))
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
      .leftJoin(
        plateModelAnalysis,
        and(eq(plateModelAnalysis.workspaceId, requests.workspaceId), eq(plateModelAnalysis.requestId, requests.id)),
      )
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
    const workspaceId = this.workspace()
    const row = database
      .select(requestSelection)
      .from(requests)
      .innerJoin(user, eq(user.id, requests.ownerUserId))
      .leftJoin(
        plateModelAnalysis,
        and(eq(plateModelAnalysis.workspaceId, requests.workspaceId), eq(plateModelAnalysis.requestId, requests.id)),
      )
      .where(and(eq(requests.workspaceId, workspaceId), eq(requests.id, id)))
      .get()
    return row ? this.hydrate(database, row) : undefined
  }

  createRequest(request: NewPrintRequest) {
    const id = crypto.randomUUID()
    this.database.transaction((tx) => this.insertRequest(tx, id, request))
    return id
  }

  createUploadSession(uploadId: string, ownerId: string, expiresAt: number, maxIncomplete: number) {
    const workspaceId = this.workspace()
    return this.database.transaction((tx) => {
      const existing = tx
        .select({ ownerId: uploadSessions.ownerId, completedRequestId: uploadSessions.completedRequestId })
        .from(uploadSessions)
        .where(and(eq(uploadSessions.workspaceId, workspaceId), eq(uploadSessions.id, uploadId)))
        .get()
      if (existing) {
        if (existing.ownerId !== ownerId) throw new Response('upload id belongs to another user', { status: 409 })
        tx.update(uploadSessions)
          .set({ expiresAt })
          .where(
            and(eq(uploadSessions.workspaceId, workspaceId), eq(uploadSessions.id, uploadId), isNull(uploadSessions.completedRequestId)),
          )
          .run()
        return { fresh: false, completedRequestId: existing.completedRequestId ?? undefined }
      }
      const active = tx
        .select({ count: count() })
        .from(uploadSessions)
        .where(
          and(
            eq(uploadSessions.ownerId, ownerId),
            eq(uploadSessions.workspaceId, workspaceId),
            isNull(uploadSessions.completedRequestId),
            gt(uploadSessions.bytes, 0),
            gt(uploadSessions.expiresAt, Date.now()),
          ),
        )
        .get()?.count
      if ((active ?? 0) >= maxIncomplete) throw new Response('too many incomplete uploads', { status: 429 })
      tx.insert(uploadSessions).values({ id: uploadId, workspaceId, ownerId, expiresAt }).run()
      return { fresh: true }
    })
  }

  reserveUpload(uploadId: string, ownerId: string, bytes: number, expiresAt: number, limits: { count: number; bytes: number }) {
    const workspaceId = this.workspace()
    return this.database.transaction((tx) => {
      const session = tx
        .select()
        .from(uploadSessions)
        .where(and(eq(uploadSessions.workspaceId, workspaceId), eq(uploadSessions.id, uploadId)))
        .get()
      if (!session || session.ownerId !== ownerId || session.completedRequestId) return false
      const usage = tx
        .select({ count: count(), bytes: sql<number>`coalesce(sum(${uploadSessions.bytes}),0)` })
        .from(uploadSessions)
        .where(
          and(
            eq(uploadSessions.ownerId, ownerId),
            eq(uploadSessions.workspaceId, workspaceId),
            isNull(uploadSessions.completedRequestId),
            gt(uploadSessions.bytes, 0),
            gt(uploadSessions.expiresAt, Date.now()),
          ),
        )
        .get() ?? { count: 0, bytes: 0 }
      const nextCount = usage.count + (session.bytes > 0 ? 0 : 1)
      if (nextCount > limits.count || usage.bytes - session.bytes + bytes > limits.bytes) {
        if (session.bytes === 0)
          tx.delete(uploadSessions)
            .where(and(eq(uploadSessions.workspaceId, workspaceId), eq(uploadSessions.id, uploadId)))
            .run()
        return false
      }
      tx.update(uploadSessions)
        .set({ bytes, expiresAt })
        .where(and(eq(uploadSessions.workspaceId, workspaceId), eq(uploadSessions.id, uploadId)))
        .run()
      return true
    })
  }

  expireUploads(now: number) {
    const workspaceId = this.workspace()
    return this.database.transaction((tx) => {
      const expired = and(
        eq(uploadSessions.workspaceId, workspaceId),
        isNull(uploadSessions.completedRequestId),
        lte(uploadSessions.expiresAt, now),
      )
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
    const workspaceId = this.workspace()
    return new Set(
      this.database
        .select({ id: uploadSessions.id })
        .from(uploadSessions)
        .where(
          and(
            eq(uploadSessions.workspaceId, workspaceId),
            isNull(uploadSessions.completedRequestId),
            gt(uploadSessions.bytes, 0),
            gt(uploadSessions.expiresAt, now),
          ),
        )
        .all()
        .map(({ id }) => id),
    )
  }

  incompleteUploadStats(now: number) {
    const workspaceId = this.workspace()
    return (
      this.database
        .select({ count: count(), bytes: sql<number>`coalesce(sum(${uploadSessions.bytes}),0)` })
        .from(uploadSessions)
        .where(
          and(
            eq(uploadSessions.workspaceId, workspaceId),
            isNull(uploadSessions.completedRequestId),
            gt(uploadSessions.bytes, 0),
            gt(uploadSessions.expiresAt, now),
          ),
        )
        .get() ?? { count: 0, bytes: 0 }
    )
  }

  uploadIdsOwnedBy(ownerId: string) {
    const workspaceId = this.workspace()
    return this.database
      .select({ id: uploadSessions.id })
      .from(uploadSessions)
      .where(and(eq(uploadSessions.workspaceId, workspaceId), eq(uploadSessions.ownerId, ownerId)))
      .all()
      .map(({ id }) => id)
  }

  deleteUploadSessions(ownerId: string) {
    const workspaceId = this.workspace()
    this.database
      .delete(uploadSessions)
      .where(and(eq(uploadSessions.workspaceId, workspaceId), eq(uploadSessions.ownerId, ownerId)))
      .run()
  }

  getCompletedUpload(uploadId: string, ownerId: string) {
    const workspaceId = this.workspace()
    return (
      this.database
        .select({ id: uploadSessions.completedRequestId })
        .from(uploadSessions)
        .where(and(eq(uploadSessions.workspaceId, workspaceId), eq(uploadSessions.id, uploadId), eq(uploadSessions.ownerId, ownerId)))
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
    const workspaceId = this.workspace()
    this.database
      .update(requestStatuses)
      .set({ sortOrder: order })
      .where(and(eq(requestStatuses.workspaceId, workspaceId), eq(requestStatuses.requestId, id), eq(requestStatuses.statusId, status)))
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
        .where(and(eq(operations.workspaceId, this.workspace()), eq(operations.requestId, id), ne(operations.state, 'committed')))
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
          .where(
            and(
              eq(requestStatuses.workspaceId, this.workspace()),
              eq(requestStatuses.requestId, id),
              eq(requestStatuses.statusId, initialStatus().id),
            ),
          )
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
        .where(and(eq(requests.workspaceId, this.workspace()), eq(requests.id, id)))
        .run()
    })
  }

  deleteRequest(id: string, database: DatabaseExecutor = this.database) {
    database
      .delete(requests)
      .where(and(eq(requests.workspaceId, this.workspace()), eq(requests.id, id)))
      .run()
  }

  requestsNeedingAssets() {
    return this.database
      .selectDistinct({ id: requests.id })
      .from(requests)
      .innerJoin(
        assetGenerationJobs,
        and(eq(assetGenerationJobs.workspaceId, requests.workspaceId), eq(assetGenerationJobs.requestId, requests.id)),
      )
      .where(and(eq(requests.workspaceId, this.workspace()), inArray(assetGenerationJobs.status, ['pending', 'running'])))
      .orderBy(requests.createdAt)
      .all()
      .map(({ id }) => id)
  }

  queueAssetGeneration(id: string) {
    const request = this.getRequest(id)
    if (!request) return
    const workspaceId = this.workspace()
    const now = Date.now()
    this.database.transaction((tx) => {
      const jobs: (typeof assetGenerationJobs.$inferInsert)[] = [
        ...(!request.thumbnailPath
          ? ([{ workspaceId, requestId: id, stage: 'thumbnail', status: 'pending', queuedAt: now }] as const)
          : []),
        ...(!request.previewPath ? ([{ workspaceId, requestId: id, stage: 'preview', status: 'pending', queuedAt: now }] as const) : []),
      ]
      if (jobs.length) tx.insert(assetGenerationJobs).values(jobs).onConflictDoNothing().run()
      tx.update(requests)
        .set({ assetsGeneratedAt: null })
        .where(and(eq(requests.workspaceId, this.workspace()), eq(requests.id, id)))
        .run()
    })
  }

  requeueAssetGeneration(id: string, stages: import('../core/types').AssetGenerationStage[]) {
    const workspaceId = this.workspace()
    this.database.transaction((tx) => {
      const now = Date.now()
      tx.update(assetGenerationJobs)
        .set({ status: 'pending', error: null, queuedAt: now, startedAt: null, finishedAt: null })
        .where(
          and(
            eq(assetGenerationJobs.workspaceId, workspaceId),
            eq(assetGenerationJobs.requestId, id),
            inArray(assetGenerationJobs.stage, stages),
          ),
        )
        .run()
      tx.update(requests)
        .set({ assetsGeneratedAt: null })
        .where(and(eq(requests.workspaceId, this.workspace()), eq(requests.id, id)))
        .run()
    })
  }

  startAssetGeneration(id: string, stages: import('../core/types').AssetGenerationStage[]) {
    const workspaceId = this.workspace()
    this.database
      .update(assetGenerationJobs)
      .set({ status: 'running', startedAt: Date.now(), finishedAt: null, error: null })
      .where(
        and(
          eq(assetGenerationJobs.workspaceId, workspaceId),
          eq(assetGenerationJobs.requestId, id),
          inArray(assetGenerationJobs.stage, stages),
          eq(assetGenerationJobs.status, 'pending'),
        ),
      )
      .run()
  }

  finishAssetGeneration(
    id: string,
    stage: import('../core/types').AssetGenerationStage,
    outcome: { status: 'ready' | 'skipped' | 'failed'; path?: string; error?: string },
  ) {
    const workspaceId = this.workspace()
    this.database.transaction((tx) => {
      const now = Date.now()
      tx.update(assetGenerationJobs)
        .set({ status: outcome.status, error: outcome.error?.slice(0, 1_000) ?? null, finishedAt: now })
        .where(
          and(
            eq(assetGenerationJobs.workspaceId, workspaceId),
            eq(assetGenerationJobs.requestId, id),
            eq(assetGenerationJobs.stage, stage),
          ),
        )
        .run()
      if (outcome.path) {
        tx.update(requests)
          .set(stage === 'thumbnail' ? { thumbnailPath: outcome.path, updatedAt: now } : { previewPath: outcome.path, updatedAt: now })
          .where(and(eq(requests.workspaceId, this.workspace()), eq(requests.id, id)))
          .run()
      }
      const unfinished = tx
        .select({ requestId: assetGenerationJobs.requestId })
        .from(assetGenerationJobs)
        .where(
          and(
            eq(assetGenerationJobs.workspaceId, workspaceId),
            eq(assetGenerationJobs.requestId, id),
            inArray(assetGenerationJobs.status, ['pending', 'running']),
          ),
        )
        .limit(1)
        .get()
      if (!unfinished)
        tx.update(requests)
          .set({ assetsGeneratedAt: now, updatedAt: now })
          .where(and(eq(requests.workspaceId, this.workspace()), eq(requests.id, id)))
          .run()
    })
  }

  listAssetGenerationJobs() {
    const workspaceId = this.workspace()
    return this.database
      .select({ job: assetGenerationJobs })
      .from(assetGenerationJobs)
      .innerJoin(requests, and(eq(requests.workspaceId, assetGenerationJobs.workspaceId), eq(requests.id, assetGenerationJobs.requestId)))
      .where(eq(assetGenerationJobs.workspaceId, workspaceId))
      .orderBy(assetGenerationJobs.queuedAt, assetGenerationJobs.stage)
      .all()
      .map(({ job }) => mapAssetGenerationJob(job))
  }

  assetGenerationJobs(id: string) {
    if (!this.getRequest(id)) return []
    const workspaceId = this.workspace()
    return this.database
      .select()
      .from(assetGenerationJobs)
      .where(and(eq(assetGenerationJobs.workspaceId, workspaceId), eq(assetGenerationJobs.requestId, id)))
      .orderBy(assetGenerationJobs.stage)
      .all()
      .map(mapAssetGenerationJob)
  }

  requeueInterruptedAssetGeneration() {
    const workspaceId = this.workspace()
    const ids = this.listRequests().map(({ id }) => id)
    if (!ids.length) return
    this.database
      .update(assetGenerationJobs)
      .set({ status: 'pending', queuedAt: Date.now(), startedAt: null, finishedAt: null, error: null })
      .where(
        and(
          eq(assetGenerationJobs.workspaceId, workspaceId),
          inArray(assetGenerationJobs.requestId, ids),
          eq(assetGenerationJobs.status, 'running'),
        ),
      )
      .run()
  }

  requestsNeedingOrientationAnalysis(analysisVersion: number) {
    const workspaceId = this.workspace()
    const profiles = this.getSetting<PrinterProfile[]>('plate-planner-profiles') ?? []
    const resinPrinterIds = profiles.filter((profile) => printerPrintType(profile) === 'resin').map((profile) => profile.id)
    const resinTarget = or(
      and(isNull(requests.printerId), eq(requests.printType, 'resin')),
      resinPrinterIds.length ? inArray(requests.printerId, resinPrinterIds) : undefined,
    )
    return this.database
      .select({ id: requests.id })
      .from(requests)
      .leftJoin(
        orientationAnalysisJobs,
        and(eq(orientationAnalysisJobs.workspaceId, requests.workspaceId), eq(orientationAnalysisJobs.requestId, requests.id)),
      )
      .leftJoin(
        plateModelAnalysis,
        and(eq(plateModelAnalysis.workspaceId, requests.workspaceId), eq(plateModelAnalysis.requestId, requests.id)),
      )
      .where(
        and(
          eq(requests.workspaceId, workspaceId),
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
        ),
      )
      .orderBy(requests.createdAt)
      .all()
      .map(({ id }) => id)
  }

  queueOrientationAnalysis(id: string, analysisVersion: number) {
    if (!this.getRequest(id)) return
    const workspaceId = this.workspace()
    const now = Date.now()
    this.database
      .insert(orientationAnalysisJobs)
      .values({ workspaceId, requestId: id, status: 'pending', analysisVersion, queuedAt: now })
      .onConflictDoUpdate({
        target: [orientationAnalysisJobs.workspaceId, orientationAnalysisJobs.requestId],
        set: { status: 'pending', analysisVersion, error: null, queuedAt: now, startedAt: null, finishedAt: null },
        where: or(ne(orientationAnalysisJobs.status, 'ready'), ne(orientationAnalysisJobs.analysisVersion, analysisVersion)),
      })
      .run()
  }

  startOrientationAnalysis(id: string, analysisVersion: number) {
    if (!this.getRequest(id)) return
    const workspaceId = this.workspace()
    this.database
      .update(orientationAnalysisJobs)
      .set({ status: 'running', startedAt: Date.now(), finishedAt: null, error: null })
      .where(
        and(
          eq(orientationAnalysisJobs.workspaceId, workspaceId),
          eq(orientationAnalysisJobs.requestId, id),
          eq(orientationAnalysisJobs.analysisVersion, analysisVersion),
        ),
      )
      .run()
  }

  failOrientationAnalysis(id: string, analysisVersion: number, error: string) {
    if (!this.getRequest(id)) return
    const workspaceId = this.workspace()
    this.database
      .update(orientationAnalysisJobs)
      .set({ status: 'failed', error: error.slice(0, 1_000), finishedAt: Date.now() })
      .where(
        and(
          eq(orientationAnalysisJobs.workspaceId, workspaceId),
          eq(orientationAnalysisJobs.requestId, id),
          eq(orientationAnalysisJobs.analysisVersion, analysisVersion),
        ),
      )
      .run()
  }

  listOrientationAnalysisJobs() {
    const workspaceId = this.workspace()
    return this.database
      .select({ job: orientationAnalysisJobs })
      .from(orientationAnalysisJobs)
      .innerJoin(
        requests,
        and(eq(requests.workspaceId, orientationAnalysisJobs.workspaceId), eq(requests.id, orientationAnalysisJobs.requestId)),
      )
      .where(eq(orientationAnalysisJobs.workspaceId, workspaceId))
      .orderBy(orientationAnalysisJobs.queuedAt)
      .all()
      .map(({ job }) => ({
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
    const workspaceId = this.workspace()
    const now = Date.now()
    this.database.transaction((tx) => {
      tx.update(requests)
        .set({
          ...(generated.thumbnailPath ? { thumbnailPath: generated.thumbnailPath } : {}),
          ...(generated.previewPath ? { previewPath: generated.previewPath } : {}),
          assetsGeneratedAt: now,
          updatedAt: now,
        })
        .where(and(eq(requests.workspaceId, this.workspace()), eq(requests.id, id)))
        .run()
      tx.update(assetGenerationJobs)
        .set({ status: generated.thumbnailPath ? 'ready' : 'failed', finishedAt: now })
        .where(
          and(
            eq(assetGenerationJobs.workspaceId, workspaceId),
            eq(assetGenerationJobs.requestId, id),
            eq(assetGenerationJobs.stage, 'thumbnail'),
          ),
        )
        .run()
      tx.update(assetGenerationJobs)
        .set({ status: generated.previewPath ? 'ready' : 'skipped', finishedAt: now })
        .where(
          and(
            eq(assetGenerationJobs.workspaceId, workspaceId),
            eq(assetGenerationJobs.requestId, id),
            eq(assetGenerationJobs.stage, 'preview'),
          ),
        )
        .run()
    })
  }

  getPlateModelAnalysis(requestId: string) {
    const workspaceId = this.workspace()
    const row = this.database
      .select({ analysis: plateModelAnalysis })
      .from(plateModelAnalysis)
      .innerJoin(requests, and(eq(requests.workspaceId, plateModelAnalysis.workspaceId), eq(requests.id, plateModelAnalysis.requestId)))
      .where(and(eq(plateModelAnalysis.workspaceId, workspaceId), eq(plateModelAnalysis.requestId, requestId)))
      .get()?.analysis
    return row ? mapPlateModelAnalysis(row) : undefined
  }

  listPlateModelAnalyses() {
    const workspaceId = this.workspace()
    return this.database
      .select({ analysis: plateModelAnalysis })
      .from(plateModelAnalysis)
      .innerJoin(requests, and(eq(requests.workspaceId, plateModelAnalysis.workspaceId), eq(requests.id, plateModelAnalysis.requestId)))
      .where(eq(plateModelAnalysis.workspaceId, workspaceId))
      .orderBy(plateModelAnalysis.requestId)
      .all()
      .map(({ analysis }) => mapPlateModelAnalysis(analysis))
  }

  upsertPlateModelAnalyses(analyses: import('../core/platePlanner').PlateModelAnalysis[]) {
    const workspaceId = this.workspace()
    this.database.transaction((tx) => {
      const now = Date.now()
      for (const analysis of analyses) {
        if (!this.getRequestFrom(tx, analysis.requestId)) continue
        const values = {
          workspaceId,
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
        tx.insert(plateModelAnalysis)
          .values(values)
          .onConflictDoUpdate({ target: [plateModelAnalysis.workspaceId, plateModelAnalysis.requestId], set: values })
          .run()
        tx.insert(orientationAnalysisJobs)
          .values({
            workspaceId,
            requestId: analysis.requestId,
            status: 'ready',
            analysisVersion: analysis.analysisVersion ?? 1,
            queuedAt: now,
            startedAt: now,
            finishedAt: now,
          })
          .onConflictDoUpdate({
            target: [orientationAnalysisJobs.workspaceId, orientationAnalysisJobs.requestId],
            set: { status: 'ready', analysisVersion: analysis.analysisVersion ?? 1, error: null, finishedAt: now },
          })
          .run()
      }
    })
  }

  findPlateModelAnalysisByContentHash(contentHash: string, analysisVersion: number) {
    const workspaceId = this.workspace()
    const row = this.database
      .select({ analysis: plateModelAnalysis })
      .from(plateModelAnalysis)
      .innerJoin(requests, and(eq(requests.workspaceId, plateModelAnalysis.workspaceId), eq(requests.id, plateModelAnalysis.requestId)))
      .where(
        and(
          eq(plateModelAnalysis.workspaceId, workspaceId),
          eq(plateModelAnalysis.contentHash, contentHash),
          eq(plateModelAnalysis.analysisVersion, analysisVersion),
        ),
      )
      .limit(1)
      .get()?.analysis
    return row ? mapPlateModelAnalysis(row) : undefined
  }

  listPeople() {
    const workspaceId = this.workspace()
    return this.database
      .select({ id: user.id, name: user.name, color: user.color })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, workspaceId))
      .orderBy(user.name, user.id)
      .all()
      .map((row) => ({ id: row.id, name: row.name, color: row.color ?? undefined }))
  }

  listUsers() {
    const workspaceId = this.workspace()
    return this.database
      .select({ id: user.id, email: user.email, name: user.name, image: user.image, role: member.role })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, workspaceId))
      .orderBy(sql`CASE ${member.role} WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END`, sql`${user.name} COLLATE NOCASE`)
      .all()
      .map((row) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        image: row.image ?? undefined,
        role: row.role === 'owner' || row.role === 'admin' ? ('admin' as const) : ('requester' as const),
        workspaceRole: row.role,
      }))
  }

  listDeploymentUsers() {
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
        deploymentAdmin: row.role === 'admin',
      }))
  }

  getDeploymentSetting<T>(key: string): T | undefined {
    const row = this.database
      .select({ value: deploymentSettings.valueJson })
      .from(deploymentSettings)
      .where(eq(deploymentSettings.key, key))
      .get()
    return row ? (JSON.parse(row.value) as T) : undefined
  }

  setDeploymentSetting(key: string, value: unknown) {
    const values = { key, valueJson: JSON.stringify(value), updatedAt: Date.now() }
    this.database.insert(deploymentSettings).values(values).onConflictDoUpdate({ target: deploymentSettings.key, set: values }).run()
  }

  getSetting<T>(key: string): T | undefined {
    return this.getSettingFrom<T>(this.database, key)
  }

  setSetting(key: string, value: unknown) {
    this.setSettingWith(this.database, key, value)
  }

  deleteSetting(key: string) {
    this.database
      .delete(settings)
      .where(and(eq(settings.workspaceId, this.workspace()), eq(settings.key, key)))
      .run()
  }

  setSettings(values: Record<string, unknown>) {
    this.database.transaction((tx) => {
      for (const [key, value] of Object.entries(values)) this.setSettingWith(tx, key, value)
    })
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
            .where(and(eq(requests.workspaceId, this.workspace()), eq(requests.printerId, profile.id)))
            .run()
          continue
        }
        if (printerPrintType(profile) !== printerPrintType(replacement)) {
          const assigned = tx
            .select({ id: requests.id })
            .from(requests)
            .where(and(eq(requests.workspaceId, this.workspace()), eq(requests.printerId, profile.id)))
            .all()
          reanalyzeRequestIds.push(...assigned.map(({ id }) => id))
        }
      }
      tx.update(requests)
        .set({ printType: null })
        .where(and(eq(requests.workspaceId, this.workspace()), isNotNull(requests.printerId)))
        .run()

      this.setSettingWith(tx, 'plate-planner-profiles', next)
      const drafts = this.getSettingFrom<Record<string, PlatePlannerDraft>>(tx, 'plate-planner-drafts') ?? {}
      const legacyDraft = this.getSettingFrom<PlatePlannerDraft>(tx, 'plate-planner-draft')
      if (legacyDraft && !drafts[legacyDraft.printerId]) drafts[legacyDraft.printerId] = legacyDraft
      for (const printerId of Object.keys(drafts)) {
        if (!nextById.has(printerId) || changedIds.has(printerId)) delete drafts[printerId]
      }
      this.setSettingWith(tx, 'plate-planner-drafts', drafts)
      tx.delete(settings)
        .where(and(eq(settings.workspaceId, this.workspace()), eq(settings.key, 'plate-planner-draft')))
        .run()
      return { reanalyzeRequestIds }
    })
  }

  countUsers() {
    return this.database.select({ count: count() }).from(user).get()?.count ?? 0
  }

  listWorkspacesForUser(userId: string): import('../core/types').WorkspaceSummary[] {
    return this.database
      .select({ id: organization.id, name: organization.name, slug: organization.slug, role: member.role })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(eq(member.userId, userId))
      .orderBy(organization.name, organization.id)
      .all()
  }

  listWorkspaces() {
    return this.database.select({ id: organization.id, name: organization.name, slug: organization.slug }).from(organization).all()
  }

  workspaceById(id: string) {
    return this.database
      .select({ id: organization.id, name: organization.name, slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, id))
      .get()
  }

  workspaceForUser(userId: string, slug: string) {
    return this.database
      .select({ id: organization.id, name: organization.name, slug: organization.slug, role: member.role })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(and(eq(member.userId, userId), eq(organization.slug, slug)))
      .get()
  }

  workspaceBySlug(slug: string) {
    return this.database
      .select({ id: organization.id, name: organization.name, slug: organization.slug })
      .from(organization)
      .where(eq(organization.slug, slug))
      .get()
  }

  isPersonalWorkspace(userId: string, workspaceId: string) {
    return Boolean(
      this.database
        .select({ id: organization.id })
        .from(organization)
        .where(and(eq(organization.id, workspaceId), eq(organization.personalOwnerId, userId)))
        .get(),
    )
  }

  setPersonalWorkspace(userId: string, workspaceId: string) {
    this.database.transaction((tx) => {
      const owned = tx
        .select({ id: organization.id })
        .from(organization)
        .innerJoin(member, and(eq(member.organizationId, organization.id), eq(member.userId, userId), eq(member.role, 'owner')))
        .where(eq(organization.id, workspaceId))
        .get()
      if (!owned) throw new Response('workspace not found', { status: 404 })
      tx.update(organization).set({ personalOwnerId: null }).where(eq(organization.personalOwnerId, userId)).run()
      tx.update(organization).set({ personalOwnerId: userId }).where(eq(organization.id, workspaceId)).run()
    })
  }

  addWorkspaceMember(userId: string, role: import('../core/types').WorkspaceRole) {
    this.database
      .insert(member)
      .values({ id: crypto.randomUUID(), organizationId: this.workspace(), userId, role, createdAt: new Date() })
      .onConflictDoNothing()
      .run()
  }

  claimInviteGlobally(tokenHash: string, now: number, email: string) {
    const row = this.database
      .update(invites)
      .set({ usedAt: now })
      .where(
        and(
          eq(invites.tokenHash, tokenHash),
          isNull(invites.usedAt),
          gt(invites.expiresAt, now),
          or(isNull(invites.recipientEmail), eq(invites.recipientEmail, email.toLowerCase())),
        ),
      )
      .returning()
      .get()
    return row
      ? {
          id: row.id,
          workspaceId: row.workspaceId,
          role: row.role,
          label: row.label ?? undefined,
          recipientEmail: row.recipientEmail ?? undefined,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
          usedAt: row.usedAt!,
        }
      : undefined
  }

  workspaceSlugForInvite(tokenHash: string, _now: number) {
    return this.database
      .select({ slug: organization.slug })
      .from(invites)
      .innerJoin(organization, eq(organization.id, invites.workspaceId))
      .where(eq(invites.tokenHash, tokenHash))
      .get()?.slug
  }

  completeInviteGlobally(id: string, userId: string) {
    const invite = this.database.select().from(invites).where(eq(invites.id, id)).get()
    if (!invite) return
    this.database.transaction((tx) => {
      tx.update(invites).set({ usedBy: userId }).where(eq(invites.id, id)).run()
      tx.insert(member)
        .values({
          id: crypto.randomUUID(),
          organizationId: invite.workspaceId,
          userId,
          role: invite.role === 'admin' ? 'admin' : 'member',
          createdAt: new Date(),
        })
        .onConflictDoNothing()
        .run()
    })
  }

  ensurePersonalWorkspace(identity: { id: string; name: string }) {
    const legacy = this.database
      .select({ id: organization.id, name: organization.name, slug: organization.slug, role: member.role })
      .from(organization)
      .innerJoin(member, and(eq(member.organizationId, organization.id), eq(member.userId, identity.id)))
      .where(eq(organization.id, 'legacy-workspace'))
      .get()
    const existing = this.database
      .select({ id: organization.id, name: organization.name, slug: organization.slug, role: member.role })
      .from(organization)
      .innerJoin(member, and(eq(member.organizationId, organization.id), eq(member.userId, identity.id)))
      .where(eq(organization.personalOwnerId, identity.id))
      .get()
    if (legacy) {
      if (!existing) {
        if (legacy.role === 'owner')
          this.database.update(organization).set({ personalOwnerId: identity.id }).where(eq(organization.id, legacy.id)).run()
        return legacy
      }
      if (existing.id === legacy.id) return existing
      const repaired = this.database.transaction((tx) => {
        const hasData =
          (tx.select({ total: count() }).from(requests).where(eq(requests.workspaceId, existing.id)).get()?.total ?? 0) > 0 ||
          (tx.select({ total: count() }).from(settings).where(eq(settings.workspaceId, existing.id)).get()?.total ?? 0) > 0 ||
          (tx.select({ total: count() }).from(operations).where(eq(operations.workspaceId, existing.id)).get()?.total ?? 0) > 0 ||
          (tx.select({ total: count() }).from(uploadSessions).where(eq(uploadSessions.workspaceId, existing.id)).get()?.total ?? 0) > 0 ||
          (tx.select({ total: count() }).from(invites).where(eq(invites.workspaceId, existing.id)).get()?.total ?? 0) > 0 ||
          (tx.select({ total: count() }).from(invitation).where(eq(invitation.organizationId, existing.id)).get()?.total ?? 0) > 0 ||
          (tx
            .select({ total: count() })
            .from(member)
            .where(and(eq(member.organizationId, existing.id), ne(member.userId, identity.id)))
            .get()?.total ?? 0) > 0
        if (hasData) return false
        tx.delete(organization).where(eq(organization.id, existing.id)).run()
        if (legacy.role === 'owner')
          tx.update(organization).set({ personalOwnerId: identity.id }).where(eq(organization.id, legacy.id)).run()
        return true
      })
      if (repaired) return legacy
    }
    if (existing) return existing
    if (process.env.NODE_ENV === 'test') {
      const testWorkspace = this.workspaceBySlug('test-workspace')
      if (testWorkspace && this.listWorkspacesForUser(identity.id).length === 0) {
        const scoped = this.scoped(testWorkspace.id)
        scoped.addWorkspaceMember(identity.id, 'owner')
        this.database.update(organization).set({ personalOwnerId: identity.id }).where(eq(organization.id, testWorkspace.id)).run()
        return { ...testWorkspace, role: 'owner' as const }
      }
    }

    return this.database.transaction((tx) => {
      const concurrent = tx
        .select({ id: organization.id, name: organization.name, slug: organization.slug, role: member.role })
        .from(organization)
        .innerJoin(member, and(eq(member.organizationId, organization.id), eq(member.userId, identity.id)))
        .where(eq(organization.personalOwnerId, identity.id))
        .get()
      if (concurrent) return concurrent

      const id = crypto.randomUUID()
      const base = workspaceSlug(identity.name)
      let slug = base
      for (let suffix = 2; tx.select({ id: organization.id }).from(organization).where(eq(organization.slug, slug)).get(); suffix++) {
        slug = `${base}-${suffix}`
      }
      const name = identity.name.trim() ? `${identity.name.trim()}'s workspace` : 'My workspace'
      const createdAt = new Date()
      tx.insert(organization).values({ id, name, slug, personalOwnerId: identity.id, createdAt }).run()
      tx.insert(member).values({ id: crypto.randomUUID(), organizationId: id, userId: identity.id, role: 'owner', createdAt }).run()
      return { id, name, slug, role: 'owner' as const }
    })
  }

  createWorkspace(identity: { id: string }, requestedName: string, initialSettings: Record<string, unknown> = {}) {
    return this.database.transaction((tx) => {
      const name = requestedName.trim()
      const duplicate = tx
        .select({ name: organization.name })
        .from(member)
        .innerJoin(organization, eq(organization.id, member.organizationId))
        .where(and(eq(member.userId, identity.id), eq(member.role, 'owner')))
        .all()
        .some((workspace) => workspaceNameKey(workspace.name) === workspaceNameKey(name))
      if (duplicate) throw new Response('you already own a workspace with this name', { status: 409 })
      const id = crypto.randomUUID()
      const base = workspaceSlug(name)
      let slug = base
      for (let suffix = 2; tx.select({ id: organization.id }).from(organization).where(eq(organization.slug, slug)).get(); suffix++) {
        slug = `${base}-${suffix}`
      }
      const createdAt = new Date()
      tx.insert(organization).values({ id, name, slug, createdAt }).run()
      tx.insert(member).values({ id: crypto.randomUUID(), organizationId: id, userId: identity.id, role: 'owner', createdAt }).run()
      for (const [key, value] of Object.entries(initialSettings)) {
        tx.insert(settings)
          .values({ workspaceId: id, key, valueJson: JSON.stringify(value), updatedAt: Date.now() })
          .run()
      }
      return { id, name, slug, role: 'owner' as const }
    })
  }

  setWorkspaceMemberRole(userId: string, role: import('../core/types').WorkspaceRole) {
    const current = this.database
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, this.workspace()), eq(member.userId, userId)))
      .get()
    if (!current) throw new Response('member not found', { status: 404 })
    if (current.role === 'owner') throw new Response('transfer workspace ownership before changing the owner role', { status: 409 })
    if (role === 'owner') throw new Response('ownership transfer is not supported here', { status: 400 })
    this.database
      .update(member)
      .set({ role })
      .where(and(eq(member.organizationId, this.workspace()), eq(member.userId, userId)))
      .run()
  }

  removeWorkspaceMember(userId: string) {
    const current = this.database
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, this.workspace()), eq(member.userId, userId)))
      .get()
    if (!current) return
    if (current.role === 'owner') throw new Response('the workspace owner cannot be removed', { status: 409 })
    this.database
      .delete(member)
      .where(and(eq(member.organizationId, this.workspace()), eq(member.userId, userId)))
      .run()
  }

  createInvite(invite: { id: string; tokenHash: string; role: Role; label?: string; recipientEmail?: string; expiresAt: number }) {
    const workspaceId = this.workspace()
    this.database
      .insert(invites)
      .values({
        id: invite.id,
        workspaceId,
        tokenHash: invite.tokenHash,
        role: invite.role,
        label: invite.label,
        recipientEmail: invite.recipientEmail,
        createdAt: Date.now(),
        expiresAt: invite.expiresAt,
      })
      .run()
  }

  listInvites() {
    const workspaceId = this.workspace()
    return this.database
      .select()
      .from(invites)
      .where(eq(invites.workspaceId, workspaceId))
      .orderBy(desc(invites.createdAt))
      .all()
      .map((row) => ({
        id: row.id,
        role: row.role,
        label: row.label ?? undefined,
        recipientEmail: row.recipientEmail ?? undefined,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        usedAt: row.usedAt ?? undefined,
      }))
  }

  findInvite(tokenHash: string) {
    const workspaceId = this.workspace()
    const row = this.database
      .select()
      .from(invites)
      .where(and(eq(invites.workspaceId, workspaceId), eq(invites.tokenHash, tokenHash)))
      .get()
    return row
      ? {
          id: row.id,
          role: row.role,
          label: row.label ?? undefined,
          recipientEmail: row.recipientEmail ?? undefined,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
          usedAt: row.usedAt ?? undefined,
        }
      : undefined
  }

  claimInvite(tokenHash: string, now: number) {
    const workspaceId = this.workspace()
    const row = this.database
      .update(invites)
      .set({ usedAt: now })
      .where(
        and(eq(invites.workspaceId, workspaceId), eq(invites.tokenHash, tokenHash), isNull(invites.usedAt), gt(invites.expiresAt, now)),
      )
      .returning()
      .get()
    return row
      ? {
          id: row.id,
          role: row.role,
          label: row.label ?? undefined,
          recipientEmail: row.recipientEmail ?? undefined,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
          usedAt: row.usedAt!,
        }
      : undefined
  }

  completeInvite(id: string, userId: string) {
    this.database
      .update(invites)
      .set({ usedBy: userId })
      .where(and(eq(invites.workspaceId, this.workspace()), eq(invites.id, id)))
      .run()
  }

  acceptInviteForUser(tokenHash: string, now: number, identity: { id: string; email: string }) {
    const workspaceId = this.workspace()
    return this.database.transaction((tx) => {
      const invite = tx
        .select()
        .from(invites)
        .where(
          and(eq(invites.workspaceId, workspaceId), eq(invites.tokenHash, tokenHash), isNull(invites.usedAt), gt(invites.expiresAt, now)),
        )
        .get()
      if (!invite) return undefined
      if (invite.recipientEmail && invite.recipientEmail !== identity.email.toLowerCase()) {
        throw new Response('this invitation belongs to another account', { status: 403 })
      }
      tx.update(invites).set({ usedAt: now, usedBy: identity.id }).where(eq(invites.id, invite.id)).run()
      tx.insert(member)
        .values({
          id: crypto.randomUUID(),
          organizationId: workspaceId,
          userId: identity.id,
          role: invite.role === 'admin' ? 'admin' : 'member',
          createdAt: new Date(),
        })
        .onConflictDoNothing()
        .run()
      return {
        id: invite.id,
        role: invite.role,
        label: invite.label ?? undefined,
        recipientEmail: invite.recipientEmail ?? undefined,
        createdAt: invite.createdAt,
        expiresAt: invite.expiresAt,
        usedAt: now,
      }
    })
  }

  deleteInvite(id: string) {
    this.database
      .delete(invites)
      .where(and(eq(invites.workspaceId, this.workspace()), eq(invites.id, id), isNull(invites.usedAt)))
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
          workspaceId: this.workspace(),
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
          workspaceId: this.workspace(),
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
      .where(and(eq(operations.workspaceId, this.workspace()), eq(operations.id, id), eq(operations.state, 'prepared')))
      .run()
  }

  completeMoveOperation(id: string, input: { id: string; from: string; to: string; count: number; filePath: string; order?: number }) {
    this.database.transaction((tx) => {
      const operation = tx
        .select({ state: operations.state })
        .from(operations)
        .where(and(eq(operations.workspaceId, this.workspace()), eq(operations.id, id)))
        .get()
      if (!operation || operation.state === 'committed') return
      this.moveCopies(input, tx)
      tx.update(operations)
        .set({ state: 'committed', updatedAt: Date.now() })
        .where(and(eq(operations.workspaceId, this.workspace()), eq(operations.id, id)))
        .run()
    })
  }

  completeDeleteOperation(id: string, requestId: string) {
    this.database.transaction((tx) => {
      const operation = tx
        .select({ state: operations.state })
        .from(operations)
        .where(and(eq(operations.workspaceId, this.workspace()), eq(operations.id, id)))
        .get()
      if (!operation || operation.state === 'committed') return
      this.deleteRequest(requestId, tx)
      tx.update(operations)
        .set({ state: 'committed', updatedAt: Date.now() })
        .where(and(eq(operations.workspaceId, this.workspace()), eq(operations.id, id)))
        .run()
    })
  }

  completeUploadOperation(id: string, payload: UploadOperation) {
    return this.database.transaction((tx) => {
      const completed = this.getCompletedUploadFrom(tx, payload.uploadId, payload.ownerId)
      if (completed) return completed
      const operation = tx
        .select({ state: operations.state })
        .from(operations)
        .where(and(eq(operations.workspaceId, this.workspace()), eq(operations.id, id)))
        .get()
      if (!operation) throw new Error('upload operation is missing')
      this.insertRequest(tx, payload.requestId, { ...payload.request, filePath: payload.destinationPath })
      tx.update(uploadSessions)
        .set({ completedRequestId: payload.requestId, bytes: 0 })
        .where(
          and(
            eq(uploadSessions.workspaceId, this.workspace()),
            eq(uploadSessions.id, payload.uploadId),
            eq(uploadSessions.ownerId, payload.ownerId),
          ),
        )
        .run()
      tx.update(operations)
        .set({ state: 'committed', updatedAt: Date.now() })
        .where(and(eq(operations.workspaceId, this.workspace()), eq(operations.id, id)))
        .run()
      return payload.requestId
    })
  }

  listOperations() {
    return this.database
      .select({ id: operations.id, state: operations.state, payloadJson: operations.payloadJson })
      .from(operations)
      .where(eq(operations.workspaceId, this.workspace()))
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
      .where(and(eq(operations.workspaceId, this.workspace()), eq(operations.id, id), eq(operations.state, 'committed')))
      .run()
  }
  abandonOperation(id: string) {
    this.database
      .delete(operations)
      .where(and(eq(operations.workspaceId, this.workspace()), eq(operations.id, id)))
      .run()
  }

  private hydrate(database: DatabaseExecutor, row: RequestRow): PrintRequest {
    const states = database
      .select()
      .from(requestStatuses)
      .where(and(eq(requestStatuses.workspaceId, row.workspaceId), eq(requestStatuses.requestId, row.id)))
      .all()
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
        and(
          eq(requestStatuses.workspaceId, this.workspace()),
          inArray(
            requestStatuses.requestId,
            rows.map((row) => row.id),
          ),
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
    const conditions: SQL[] = [eq(requests.workspaceId, this.workspace())]

    if (query.visibleToUserId) conditions.push(eq(requests.ownerUserId, query.visibleToUserId))
    if (options.includeOwner !== false && query.ownerUserId) conditions.push(eq(requests.ownerUserId, query.ownerUserId))
    if (filters.query) {
      const pattern = `%${escapeLike(filters.query.toLowerCase())}%`
      const privateMetadata = query.searchPrivateMetadata ? sql` || ' ' || ${requests.fileName} || ' ' || ${user.email}` : sql``
      conditions.push(
        sql`(lower(${requests.id} || ' ' || ${requests.name}${privateMetadata} || ' ' ||
          ${user.name} || ' ' || coalesce(${requests.notes},'') || ' ' || coalesce(${requests.sourceUrl},'')) LIKE ${pattern} ESCAPE char(92)
          OR EXISTS (SELECT 1 FROM ${requestStatuses} search_status
            WHERE search_status.workspace_id = ${requests.workspaceId} AND search_status.request_id = ${requests.id} AND search_status.quantity > 0
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
    const workspaceId = this.workspace()
    db.insert(requests)
      .values({
        id,
        workspaceId,
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
          workspaceId,
          requestId: id,
          statusId: status.id,
          quantity: status.id === initialStatus().id ? request.quantity : 0,
        })),
      )
      .run()
    db.insert(assetGenerationJobs)
      .values([
        {
          workspaceId,
          requestId: id,
          stage: 'thumbnail',
          status: request.thumbnailPath ? 'ready' : 'pending',
          queuedAt: now,
          finishedAt: request.thumbnailPath ? now : null,
        },
        {
          workspaceId,
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
      const workspaceId = this.workspace()
      const configured = new Set(workflow.statuses.map((status) => status.id))
      const workspaceRequestIds = tx.select({ id: requests.id }).from(requests).where(eq(requests.workspaceId, workspaceId))
      const existing = tx
        .selectDistinct({ statusId: requestStatuses.statusId })
        .from(requestStatuses)
        .where(and(eq(requestStatuses.workspaceId, workspaceId), inArray(requestStatuses.requestId, workspaceRequestIds)))
        .all()
      for (const { statusId } of existing) {
        if (configured.has(statusId)) continue
        const used = tx
          .select({ requestId: requestStatuses.requestId })
          .from(requestStatuses)
          .where(
            and(
              inArray(requestStatuses.requestId, workspaceRequestIds),
              eq(requestStatuses.workspaceId, workspaceId),
              eq(requestStatuses.statusId, statusId),
              gt(requestStatuses.quantity, 0),
            ),
          )
          .limit(1)
          .get()
        if (used) throw new Error(`workflow status ${statusId} still has copies and cannot be removed`)
        tx.delete(requestStatuses)
          .where(
            and(
              eq(requestStatuses.workspaceId, workspaceId),
              inArray(requestStatuses.requestId, workspaceRequestIds),
              eq(requestStatuses.statusId, statusId),
            ),
          )
          .run()
      }
      const requestIds = workspaceRequestIds.all()
      const statuses = requestIds.flatMap(({ id }) =>
        workflow.statuses.map((status) => ({ workspaceId, requestId: id, statusId: status.id, quantity: 0 })),
      )
      if (statuses.length) tx.insert(requestStatuses).values(statuses).onConflictDoNothing().run()
    })
  }

  private getCompletedUploadFrom(db: DatabaseExecutor, uploadId: string, ownerId: string) {
    return (
      db
        .select({ id: uploadSessions.completedRequestId })
        .from(uploadSessions)
        .where(and(eq(uploadSessions.workspaceId, this.workspace()), eq(uploadSessions.id, uploadId), eq(uploadSessions.ownerId, ownerId)))
        .get()?.id ?? undefined
    )
  }

  private getSettingFrom<T>(db: DatabaseExecutor, key: string): T | undefined {
    const row = db
      .select({ value: settings.valueJson })
      .from(settings)
      .where(and(eq(settings.workspaceId, this.workspace()), eq(settings.key, key)))
      .get()
    return row ? (JSON.parse(row.value) as T) : undefined
  }

  private setSettingWith(db: DatabaseExecutor, key: string, value: unknown) {
    const values = { workspaceId: this.workspace(), key, valueJson: JSON.stringify(value), updatedAt: Date.now() }
    db.insert(settings)
      .values(values)
      .onConflictDoUpdate({ target: [settings.workspaceId, settings.key], set: values })
      .run()
  }

  private moveCopiesWith(
    db: DatabaseExecutor,
    input: { id: string; from: string; to: string; count: number; filePath: string; order?: number },
  ) {
    const workspaceId = this.workspace()
    const from = db
      .select({ quantity: requestStatuses.quantity })
      .from(requestStatuses)
      .where(
        and(
          eq(requestStatuses.workspaceId, workspaceId),
          eq(requestStatuses.requestId, input.id),
          eq(requestStatuses.statusId, input.from),
        ),
      )
      .get()
    if (!from || from.quantity < input.count) throw new Error('invalid move')
    const target = db
      .select({ quantity: requestStatuses.quantity })
      .from(requestStatuses)
      .where(
        and(eq(requestStatuses.workspaceId, workspaceId), eq(requestStatuses.requestId, input.id), eq(requestStatuses.statusId, input.to)),
      )
      .get()
    if (!target) throw new Error('invalid target status')
    db.update(requestStatuses)
      .set({
        quantity: sql`${requestStatuses.quantity} - ${input.count}`,
        sortOrder: sql`CASE WHEN ${requestStatuses.quantity} - ${input.count} = 0 THEN NULL ELSE ${requestStatuses.sortOrder} END`,
      })
      .where(
        and(
          eq(requestStatuses.workspaceId, workspaceId),
          eq(requestStatuses.requestId, input.id),
          eq(requestStatuses.statusId, input.from),
        ),
      )
      .run()
    db.update(requestStatuses)
      .set({
        quantity: sql`${requestStatuses.quantity} + ${input.count}`,
        sortOrder: sql`CASE WHEN ${requestStatuses.quantity} = 0 THEN ${input.order ?? null} ELSE ${requestStatuses.sortOrder} END`,
      })
      .where(
        and(eq(requestStatuses.workspaceId, workspaceId), eq(requestStatuses.requestId, input.id), eq(requestStatuses.statusId, input.to)),
      )
      .run()
    db.update(requests)
      .set({ filePath: input.filePath, updatedAt: Date.now() })
      .where(and(eq(requests.workspaceId, this.workspace()), eq(requests.id, input.id)))
      .run()
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

function workspaceSlug(name: string) {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || 'workspace'
}

function workspaceNameKey(name: string) {
  return name.trim().normalize('NFKC').toLocaleLowerCase('en-US')
}

export function databasePath() {
  return path.join(path.resolve(process.env.DATA_DIR ?? '/data'), 'printhub.sqlite')
}
