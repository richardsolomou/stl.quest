import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import initialMigration from './migrations/001_initial.sql?raw'
import operationsMigration from './migrations/002_operations.sql?raw'
import durableUploadsMigration from './migrations/003_uploads_and_reservations.sql?raw'
import settingsMigration from './migrations/004_settings.sql?raw'
import betterAuthMigration from './migrations/005_better_auth.sql?raw'
import assetGenerationMigration from './migrations/006_asset_generation.sql?raw'
import invitesMigration from './migrations/007_invites.sql?raw'
import authRateLimitMigration from './migrations/008_auth_rate_limit.sql?raw'
import adminRoleMigration from './migrations/009_admin_role.sql?raw'
import platePlannerMigration from './migrations/010_plate_planner.sql?raw'
import resinOrientationMigration from './migrations/011_resin_orientation.sql?raw'
import resinOrientationCandidatesMigration from './migrations/012_resin_orientation_candidates.sql?raw'
import orientationAnalysisJobsMigration from './migrations/013_orientation_analysis_jobs.sql?raw'
import assetStageJobsMigration from './migrations/014_asset_stage_jobs.sql?raw'
import twoFactorMigration from './migrations/015_two_factor.sql?raw'
import type {
  NewPrintRequest,
  OperationPayload,
  PendingOperation,
  PrintRequest,
  Repository,
  RequestFilters,
  RequestQuery,
  Role,
  UploadOperation,
} from '../core/types'
import { initialStatus, workflow } from '../core/workflow'
import { backupDatabase } from './sqliteBackup'

const migrations = [
  { version: 1, sql: initialMigration },
  { version: 2, sql: operationsMigration },
  { version: 3, sql: durableUploadsMigration },
  { version: 4, sql: settingsMigration },
  { version: 5, sql: betterAuthMigration },
  { version: 6, sql: assetGenerationMigration },
  { version: 7, sql: invitesMigration },
  { version: 8, sql: authRateLimitMigration },
  { version: 9, sql: adminRoleMigration },
  { version: 10, sql: platePlannerMigration },
  { version: 11, sql: resinOrientationMigration },
  { version: 12, sql: resinOrientationCandidatesMigration },
  { version: 13, sql: orientationAnalysisJobsMigration },
  { version: 14, sql: assetStageJobsMigration },
  { version: 15, sql: twoFactorMigration },
]

type RequestRow = {
  id: string
  name: string
  file_name: string
  file_path: string
  quantity: number
  requester_email: string
  requester_name: string | null
  notes: string | null
  source_url: string | null
  thumbnail_path: string | null
  preview_path: string | null
  created_at: number
  updated_at: number
}

type SqlFilterOptions = { omitRequester?: boolean; includeOwner?: boolean }

type AssetGenerationJobRow = {
  request_id: string
  stage: import('../core/types').AssetGenerationStage
  status: import('../core/types').AssetGenerationJob['status']
  error: string | null
  queued_at: number
  started_at: number | null
  finished_at: number | null
}

function mapAssetGenerationJob(job: AssetGenerationJobRow): import('../core/types').AssetGenerationJob {
  return {
    requestId: job.request_id,
    stage: job.stage,
    status: job.status,
    error: job.error ?? undefined,
    queuedAt: job.queued_at,
    startedAt: job.started_at ?? undefined,
    finishedAt: job.finished_at ?? undefined,
  }
}

function mapPlateModelAnalysis(row: unknown): import('../core/platePlanner').PlateModelAnalysis {
  const analysis = row as {
    request_id: string
    width_mm: number
    depth_mm: number
    height_mm: number
    orientation_quaternion: string | null
    orientation_island_count: number | null
    orientation_risk: number | null
    orientation_candidates: string | null
    content_hash: string | null
    analysis_version: number
  }
  return {
    requestId: analysis.request_id,
    widthMm: analysis.width_mm,
    depthMm: analysis.depth_mm,
    heightMm: analysis.height_mm,
    orientationQuaternion: analysis.orientation_quaternion
      ? (JSON.parse(analysis.orientation_quaternion) as [number, number, number, number])
      : undefined,
    orientationIslandCount: analysis.orientation_island_count ?? undefined,
    orientationRisk: analysis.orientation_risk ?? undefined,
    orientationCandidates: analysis.orientation_candidates
      ? (JSON.parse(analysis.orientation_candidates) as import('../core/mesh/resinOrientation').ResinOrientation[])
      : undefined,
    contentHash: analysis.content_hash ?? undefined,
    analysisVersion: analysis.analysis_version,
  }
}

const ORDER_BY: Record<NonNullable<RequestFilters['sort']>, string> = {
  board: 'r.created_at DESC',
  'updated-desc': 'r.updated_at DESC, r.created_at DESC',
  'updated-asc': 'r.updated_at ASC, r.created_at ASC',
  'created-desc': 'r.created_at DESC',
  'created-asc': 'r.created_at ASC',
  'name-asc': 'r.name COLLATE NOCASE ASC, r.created_at DESC',
  'name-desc': 'r.name COLLATE NOCASE DESC, r.created_at DESC',
  'quantity-desc': 'r.quantity DESC, r.created_at DESC',
  'quantity-asc': 'r.quantity ASC, r.created_at DESC',
}

function requestOrderBy(sort: RequestFilters['sort']) {
  return ORDER_BY[sort ?? 'board']
}

function escapeLike(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

export class SqliteRepository implements Repository {
  // Shared with better-auth, which manages its own tables on this connection.
  readonly database: Database.Database
  private lastIntegrity = { integrity: 'unknown', checkedAt: 0 }

  constructor(private db: Database.Database) {
    this.database = db
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = FULL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('busy_timeout = 5000')
    this.migrate()
    this.maintain()
  }

  static open(file = databasePath()) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    return new SqliteRepository(new Database(file))
  }

  close() {
    this.db.close()
  }

  databaseInfo() {
    const file = this.db.name
    const sizeBytes = file && file !== ':memory:' ? fs.statSync(file).size : 0
    return { path: file, sizeBytes, integrity: this.lastIntegrity.integrity, lastCheckedAt: this.lastIntegrity.checkedAt }
  }

  maintain() {
    const result = this.db.pragma('quick_check', { simple: true })
    const integrity = typeof result === 'string' ? result : String(result)
    if (integrity !== 'ok') throw new Error(`database integrity check failed: ${integrity}`)
    this.db.pragma('optimize')
    this.db.pragma('wal_checkpoint(PASSIVE)')
    this.lastIntegrity = { integrity, checkedAt: Date.now() }
    return { integrity, checkedAt: this.lastIntegrity.checkedAt }
  }

  async backup(destination: string) {
    return backupDatabase(this.db, destination)
  }

  listRequests() {
    return this.hydrateRows(this.db.prepare('SELECT * FROM requests ORDER BY created_at DESC').all() as RequestRow[])
  }

  queryRequests(query: RequestQuery = {}) {
    const filters = query.filters ?? {}
    const filtered = this.requestConditions(filters, query)
    const orderBy = requestOrderBy(filters.sort)
    const rows = this.db.prepare(`SELECT r.* FROM requests r ${filtered.sql} ORDER BY ${orderBy}`).all(...filtered.params) as RequestRow[]

    const requesterConditions = this.requestConditions(filters, query, { omitRequester: true })
    const requesters = this.db
      .prepare(
        `SELECT CASE WHEN trim(coalesce(r.requester_name,'')) = '' THEN 'Unknown requester' ELSE r.requester_name END label,
                count(*) count
           FROM requests r ${requesterConditions.sql}
          GROUP BY label COLLATE NOCASE
          ORDER BY label COLLATE NOCASE`,
      )
      .all(...requesterConditions.params) as { label: string; count: number }[]

    const availableConditions = this.requestConditions({}, query, { includeOwner: false })
    const available = this.db
      .prepare(`SELECT count(*) count FROM requests r ${availableConditions.sql}`)
      .get(...availableConditions.params) as {
      count: number
    }

    return {
      requests: this.hydrateRows(rows),
      facets: {
        requesters: requesters.map(({ label, count }) => ({ value: label, label, count })),
        total: rows.length,
        available: available.count,
      },
    }
  }

  getRequest(id: string) {
    const row = this.db.prepare('SELECT * FROM requests WHERE id = ?').get(id) as RequestRow | undefined
    return row ? this.hydrate(row) : undefined
  }

  createRequest(request: NewPrintRequest) {
    const id = crypto.randomUUID()
    this.db.transaction(() => this.insertRequest(id, request))()
    return id
  }

  createUploadSession(uploadId: string, ownerId: string, expiresAt: number, maxIncomplete: number) {
    return this.db.transaction(() => {
      const existing = this.db.prepare('SELECT owner_id,completed_request_id FROM upload_sessions WHERE id=?').get(uploadId) as
        | { owner_id: string; completed_request_id: string | null }
        | undefined
      if (existing) {
        if (existing.owner_id !== ownerId) throw new Response('upload id belongs to another user', { status: 409 })
        this.db.prepare('UPDATE upload_sessions SET expires_at=? WHERE id=? AND completed_request_id IS NULL').run(expiresAt, uploadId)
        return { fresh: false, completedRequestId: existing.completed_request_id ?? undefined }
      }
      const active = (
        this.db
          .prepare(
            'SELECT count(*) count FROM upload_sessions WHERE owner_id=? AND completed_request_id IS NULL AND bytes>0 AND expires_at>?',
          )
          .get(ownerId, Date.now()) as { count: number }
      ).count
      if (active >= maxIncomplete) throw new Response('too many incomplete uploads', { status: 429 })
      this.db.prepare('INSERT INTO upload_sessions (id,owner_id,expires_at) VALUES (?,?,?)').run(uploadId, ownerId, expiresAt)
      return { fresh: true }
    })()
  }

  reserveUpload(uploadId: string, ownerId: string, bytes: number, expiresAt: number, limits: { count: number; bytes: number }) {
    return this.db.transaction(() => {
      const session = this.db.prepare('SELECT owner_id,completed_request_id FROM upload_sessions WHERE id=?').get(uploadId) as
        | { owner_id: string; completed_request_id: string | null }
        | undefined
      if (!session || session.owner_id !== ownerId || session.completed_request_id) return false
      const usage = this.db
        .prepare(
          'SELECT count(*) count,coalesce(sum(bytes),0) bytes FROM upload_sessions WHERE owner_id=? AND completed_request_id IS NULL AND bytes>0 AND expires_at>?',
        )
        .get(ownerId, Date.now()) as { count: number; bytes: number }
      const current = this.db.prepare('SELECT bytes FROM upload_sessions WHERE id=?').get(uploadId) as { bytes: number }
      const nextCount = usage.count + (current.bytes > 0 ? 0 : 1)
      if (nextCount > limits.count || usage.bytes - current.bytes + bytes > limits.bytes) {
        if (current.bytes === 0) this.db.prepare('DELETE FROM upload_sessions WHERE id=?').run(uploadId)
        return false
      }
      this.db.prepare('UPDATE upload_sessions SET bytes=?,expires_at=? WHERE id=?').run(bytes, expiresAt, uploadId)
      return true
    })()
  }

  expireUploads(now: number) {
    return this.db.transaction(() => {
      const ids = (
        this.db.prepare('SELECT id FROM upload_sessions WHERE completed_request_id IS NULL AND expires_at<=?').all(now) as { id: string }[]
      ).map(({ id }) => id)
      this.db.prepare('DELETE FROM upload_sessions WHERE completed_request_id IS NULL AND expires_at<=?').run(now)
      return ids
    })()
  }

  activeUploadIds(now: number) {
    return new Set(
      (
        this.db.prepare('SELECT id FROM upload_sessions WHERE completed_request_id IS NULL AND bytes>0 AND expires_at>?').all(now) as {
          id: string
        }[]
      ).map(({ id }) => id),
    )
  }

  incompleteUploadStats(now: number) {
    return this.db
      .prepare(
        'SELECT count(*) count,coalesce(sum(bytes),0) bytes FROM upload_sessions WHERE completed_request_id IS NULL AND bytes>0 AND expires_at>?',
      )
      .get(now) as { count: number; bytes: number }
  }

  getCompletedUpload(uploadId: string, ownerId: string) {
    return (
      (
        this.db.prepare('SELECT completed_request_id id FROM upload_sessions WHERE id=? AND owner_id=?').get(uploadId, ownerId) as
          | { id: string | null }
          | undefined
      )?.id ?? undefined
    )
  }

  moveCopies(input: { id: string; from: string; to: string; count: number; filePath: string; order?: number }) {
    this.db.transaction(() => {
      const from = this.db.prepare('SELECT quantity FROM request_statuses WHERE request_id=? AND status_id=?').get(input.id, input.from) as
        | { quantity: number }
        | undefined
      if (!from || from.quantity < input.count) throw new Error('invalid move')
      const target = this.db.prepare('SELECT quantity FROM request_statuses WHERE request_id=? AND status_id=?').get(input.id, input.to) as
        | { quantity: number }
        | undefined
      if (!target) throw new Error('invalid target status')
      this.db
        .prepare(
          'UPDATE request_statuses SET quantity=quantity-?, sort_order=CASE WHEN quantity-?=0 THEN NULL ELSE sort_order END WHERE request_id=? AND status_id=?',
        )
        .run(input.count, input.count, input.id, input.from)
      this.db
        .prepare(
          'UPDATE request_statuses SET quantity=quantity+?, sort_order=CASE WHEN quantity=0 THEN ? ELSE sort_order END WHERE request_id=? AND status_id=?',
        )
        .run(input.count, input.order ?? null, input.id, input.to)
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
        this.db
          .prepare('UPDATE request_statuses SET quantity=? WHERE request_id=? AND status_id=?')
          .run(fields.quantity - started, id, initialStatus().id)
      }
      this.db
        .prepare(`UPDATE requests SET name=?, quantity=?, requester_name=?, notes=?, source_url=?, updated_at=? WHERE id=?`)
        .run(
          fields.name ?? request.name,
          fields.quantity ?? request.quantity,
          fields.requesterName ?? request.requesterName ?? null,
          fields.notes ?? request.notes ?? null,
          fields.sourceUrl ?? request.sourceUrl ?? null,
          Date.now(),
          id,
        )
    })()
  }

  deleteRequest(id: string) {
    this.db.prepare('DELETE FROM requests WHERE id=?').run(id)
  }

  requestsNeedingAssets() {
    return (
      this.db
        .prepare(
          `SELECT DISTINCT requests.id
           FROM requests
           JOIN asset_generation_jobs jobs ON jobs.request_id=requests.id
           WHERE jobs.status IN ('pending','running')
           ORDER BY requests.created_at`,
        )
        .all() as { id: string }[]
    ).map(({ id }) => id)
  }

  queueAssetGeneration(id: string) {
    const request = this.getRequest(id)
    if (!request) return
    const now = Date.now()
    const statement = this.db.prepare(
      `INSERT INTO asset_generation_jobs(request_id,stage,status,error,queued_at,started_at,finished_at)
       VALUES(?,?,'pending',NULL,?,NULL,NULL)
       ON CONFLICT(request_id,stage) DO NOTHING`,
    )
    this.db.transaction(() => {
      if (!request.thumbnailPath) statement.run(id, 'thumbnail', now)
      if (!request.previewPath) statement.run(id, 'preview', now)
      this.db.prepare('UPDATE requests SET assets_generated_at=NULL WHERE id=?').run(id)
    })()
  }

  requeueAssetGeneration(id: string, stages: import('../core/types').AssetGenerationStage[]) {
    const statement = this.db.prepare(
      `UPDATE asset_generation_jobs
       SET status='pending',error=NULL,queued_at=?,started_at=NULL,finished_at=NULL
       WHERE request_id=? AND stage=?`,
    )
    this.db.transaction(() => {
      const now = Date.now()
      for (const stage of stages) statement.run(now, id, stage)
      this.db.prepare('UPDATE requests SET assets_generated_at=NULL WHERE id=?').run(id)
    })()
  }

  startAssetGeneration(id: string, stages: import('../core/types').AssetGenerationStage[]) {
    const statement = this.db.prepare(
      `UPDATE asset_generation_jobs SET status='running',started_at=?,finished_at=NULL,error=NULL
       WHERE request_id=? AND stage=? AND status='pending'`,
    )
    this.db.transaction(() => {
      const now = Date.now()
      for (const stage of stages) statement.run(now, id, stage)
    })()
  }

  finishAssetGeneration(
    id: string,
    stage: import('../core/types').AssetGenerationStage,
    outcome: { status: 'ready' | 'skipped' | 'failed'; path?: string; error?: string },
  ) {
    this.db.transaction(() => {
      const now = Date.now()
      this.db
        .prepare(
          `UPDATE asset_generation_jobs SET status=?,error=?,finished_at=?
           WHERE request_id=? AND stage=?`,
        )
        .run(outcome.status, outcome.error?.slice(0, 1_000) ?? null, now, id, stage)
      if (outcome.path) {
        this.db
          .prepare(
            stage === 'thumbnail'
              ? 'UPDATE requests SET thumbnail_path=?,updated_at=? WHERE id=?'
              : 'UPDATE requests SET preview_path=?,updated_at=? WHERE id=?',
          )
          .run(outcome.path, now, id)
      }
      const unfinished = this.db
        .prepare(`SELECT 1 FROM asset_generation_jobs WHERE request_id=? AND status IN ('pending','running') LIMIT 1`)
        .get(id)
      if (!unfinished) this.db.prepare('UPDATE requests SET assets_generated_at=?,updated_at=? WHERE id=?').run(now, now, id)
    })()
  }

  listAssetGenerationJobs() {
    return (this.db.prepare('SELECT * FROM asset_generation_jobs ORDER BY queued_at,stage').all() as AssetGenerationJobRow[]).map(
      mapAssetGenerationJob,
    )
  }

  assetGenerationJobs(id: string) {
    return (
      this.db.prepare('SELECT * FROM asset_generation_jobs WHERE request_id=? ORDER BY stage').all(id) as AssetGenerationJobRow[]
    ).map(mapAssetGenerationJob)
  }

  requeueInterruptedAssetGeneration() {
    this.db
      .prepare(
        `UPDATE asset_generation_jobs
         SET status='pending',queued_at=?,started_at=NULL,finished_at=NULL,error=NULL
         WHERE status='running'`,
      )
      .run(Date.now())
  }

  requestsNeedingOrientationAnalysis(analysisVersion: number) {
    return (
      this.db
        .prepare(
          `SELECT requests.id
           FROM requests
           LEFT JOIN orientation_analysis_jobs jobs ON jobs.request_id=requests.id
           WHERE jobs.request_id IS NULL
              OR jobs.analysis_version<>?
              OR jobs.status IN ('pending','running')
           ORDER BY requests.created_at`,
        )
        .all(analysisVersion) as { id: string }[]
    ).map(({ id }) => id)
  }

  queueOrientationAnalysis(id: string, analysisVersion: number) {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO orientation_analysis_jobs(request_id,status,analysis_version,error,queued_at,started_at,finished_at)
         VALUES(?,'pending',?,NULL,?,NULL,NULL)
         ON CONFLICT(request_id) DO UPDATE SET
           status='pending',analysis_version=excluded.analysis_version,error=NULL,queued_at=excluded.queued_at,started_at=NULL,finished_at=NULL
         WHERE orientation_analysis_jobs.status<>'ready' OR orientation_analysis_jobs.analysis_version<>excluded.analysis_version`,
      )
      .run(id, analysisVersion, now)
  }

  startOrientationAnalysis(id: string, analysisVersion: number) {
    this.db
      .prepare(
        `UPDATE orientation_analysis_jobs
         SET status='running',started_at=?,finished_at=NULL,error=NULL
         WHERE request_id=? AND analysis_version=?`,
      )
      .run(Date.now(), id, analysisVersion)
  }

  failOrientationAnalysis(id: string, analysisVersion: number, error: string) {
    this.db
      .prepare(
        `UPDATE orientation_analysis_jobs
         SET status='failed',error=?,finished_at=?
         WHERE request_id=? AND analysis_version=?`,
      )
      .run(error.slice(0, 1_000), Date.now(), id, analysisVersion)
  }

  listOrientationAnalysisJobs() {
    return (
      this.db
        .prepare(
          `SELECT request_id,status,analysis_version,error,queued_at,started_at,finished_at
           FROM orientation_analysis_jobs ORDER BY queued_at`,
        )
        .all() as {
        request_id: string
        status: import('../core/platePlanner').OrientationAnalysisJob['status']
        analysis_version: number
        error: string | null
        queued_at: number
        started_at: number | null
        finished_at: number | null
      }[]
    ).map((job) => ({
      requestId: job.request_id,
      status: job.status,
      analysisVersion: job.analysis_version,
      error: job.error ?? undefined,
      queuedAt: job.queued_at,
      startedAt: job.started_at ?? undefined,
      finishedAt: job.finished_at ?? undefined,
    }))
  }

  completeAssetGeneration(id: string, generated: { thumbnailPath?: string; previewPath?: string }) {
    const now = Date.now()
    this.db.transaction(() => {
      this.db
        .prepare(
          'UPDATE requests SET thumbnail_path=COALESCE(?, thumbnail_path), preview_path=COALESCE(?, preview_path), assets_generated_at=?, updated_at=? WHERE id=?',
        )
        .run(generated.thumbnailPath ?? null, generated.previewPath ?? null, now, now, id)
      this.db
        .prepare(
          `UPDATE asset_generation_jobs SET status=CASE stage
             WHEN 'thumbnail' THEN CASE WHEN ? IS NOT NULL THEN 'ready' ELSE 'failed' END
             WHEN 'preview' THEN CASE WHEN ? IS NOT NULL THEN 'ready' ELSE 'skipped' END
           END,finished_at=?
           WHERE request_id=?`,
        )
        .run(generated.thumbnailPath ?? null, generated.previewPath ?? null, now, id)
    })()
  }

  getPlateModelAnalysis(requestId: string) {
    const row = this.db
      .prepare(
        `SELECT request_id,width_mm,depth_mm,height_mm,orientation_quaternion,orientation_island_count,orientation_risk,
                orientation_candidates,content_hash,analysis_version FROM plate_model_analysis WHERE request_id=?`,
      )
      .get(requestId)
    return row ? mapPlateModelAnalysis(row) : undefined
  }

  listPlateModelAnalyses() {
    return this.db
      .prepare(
        `SELECT request_id,width_mm,depth_mm,height_mm,orientation_quaternion,orientation_island_count,orientation_risk,
                orientation_candidates,content_hash,analysis_version FROM plate_model_analysis ORDER BY request_id`,
      )
      .all()
      .map(mapPlateModelAnalysis)
  }

  upsertPlateModelAnalyses(analyses: import('../core/platePlanner').PlateModelAnalysis[]) {
    const statement = this.db.prepare(
      `INSERT INTO plate_model_analysis(
         request_id,width_mm,depth_mm,height_mm,orientation_quaternion,orientation_island_count,orientation_risk,
         orientation_candidates,content_hash,analysis_version,analyzed_at
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(request_id) DO UPDATE SET
         width_mm=excluded.width_mm,
         depth_mm=excluded.depth_mm,
         height_mm=excluded.height_mm,
         orientation_quaternion=excluded.orientation_quaternion,
         orientation_island_count=excluded.orientation_island_count,
         orientation_risk=excluded.orientation_risk,
         orientation_candidates=excluded.orientation_candidates,
         content_hash=excluded.content_hash,
         analysis_version=excluded.analysis_version,
         analyzed_at=excluded.analyzed_at`,
    )
    this.db.transaction(() => {
      const now = Date.now()
      for (const analysis of analyses) {
        statement.run(
          analysis.requestId,
          analysis.widthMm,
          analysis.depthMm,
          analysis.heightMm,
          analysis.orientationQuaternion ? JSON.stringify(analysis.orientationQuaternion) : null,
          analysis.orientationIslandCount ?? null,
          analysis.orientationRisk ?? null,
          analysis.orientationCandidates ? JSON.stringify(analysis.orientationCandidates) : null,
          analysis.contentHash ?? null,
          analysis.analysisVersion ?? 1,
          now,
        )
        if (analysis.orientationCandidates?.length) {
          this.db
            .prepare(
              `INSERT INTO orientation_analysis_jobs(request_id,status,analysis_version,error,queued_at,started_at,finished_at)
               VALUES(?,'ready',?,NULL,?,?,?)
               ON CONFLICT(request_id) DO UPDATE SET
                 status='ready',analysis_version=excluded.analysis_version,error=NULL,finished_at=excluded.finished_at`,
            )
            .run(analysis.requestId, analysis.analysisVersion ?? 1, now, now, now)
        }
      }
    })()
  }

  findPlateModelAnalysisByContentHash(contentHash: string, analysisVersion: number) {
    const row = this.db
      .prepare(
        `SELECT request_id,width_mm,depth_mm,height_mm,orientation_quaternion,orientation_island_count,orientation_risk,
                orientation_candidates,content_hash,analysis_version
         FROM plate_model_analysis WHERE content_hash=? AND analysis_version=? LIMIT 1`,
      )
      .get(contentHash, analysisVersion) as
      | {
          request_id: string
          width_mm: number
          depth_mm: number
          height_mm: number
          orientation_quaternion: string | null
          orientation_island_count: number | null
          orientation_risk: number | null
          orientation_candidates: string | null
          content_hash: string
          analysis_version: number
        }
      | undefined
    if (!row) return undefined
    return {
      requestId: row.request_id,
      widthMm: row.width_mm,
      depthMm: row.depth_mm,
      heightMm: row.height_mm,
      orientationQuaternion: row.orientation_quaternion ? JSON.parse(row.orientation_quaternion) : undefined,
      orientationIslandCount: row.orientation_island_count ?? undefined,
      orientationRisk: row.orientation_risk ?? undefined,
      orientationCandidates: row.orientation_candidates ? JSON.parse(row.orientation_candidates) : undefined,
      contentHash: row.content_hash,
      analysisVersion: row.analysis_version,
    }
  }

  // better-auth owns the user/session/account tables; this class only reads them.
  listPeople() {
    return (this.db.prepare('SELECT name, color FROM "user" ORDER BY name').all() as { name: string; color: string | null }[]).map(
      (row) => ({ name: row.name, color: row.color ?? undefined }),
    )
  }

  listUsers() {
    return (
      this.db
        .prepare(`SELECT id, email, name, image, role FROM "user"
        ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, name COLLATE NOCASE`)
        .all() as {
        id: string
        email: string
        name: string
        image: string | null
        role: string | null
      }[]
    ).map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      image: row.image ?? undefined,
      role: row.role === 'admin' ? ('admin' as const) : ('requester' as const),
    }))
  }

  getSetting<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value_json FROM settings WHERE key=?').get(key) as { value_json: string } | undefined
    return row ? (JSON.parse(row.value_json) as T) : undefined
  }

  setSetting(key: string, value: unknown) {
    this.db
      .prepare(
        'INSERT INTO settings (key,value_json,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at',
      )
      .run(key, JSON.stringify(value), Date.now())
  }

  countUsers() {
    return (this.db.prepare('SELECT count(*) count FROM "user"').get() as { count: number }).count
  }

  createInvite(invite: { id: string; tokenHash: string; role: Role; label?: string; expiresAt: number }) {
    this.db
      .prepare('INSERT INTO invites (id,token_hash,role,label,created_at,expires_at) VALUES (?,?,?,?,?,?)')
      .run(invite.id, invite.tokenHash, invite.role, invite.label ?? null, Date.now(), invite.expiresAt)
  }

  listInvites() {
    return (
      this.db.prepare('SELECT id,role,label,created_at,expires_at,used_at FROM invites ORDER BY created_at DESC').all() as {
        id: string
        role: Role
        label: string | null
        created_at: number
        expires_at: number
        used_at: number | null
      }[]
    ).map((row) => ({
      id: row.id,
      role: row.role,
      label: row.label ?? undefined,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      usedAt: row.used_at ?? undefined,
    }))
  }

  findInvite(tokenHash: string) {
    const row = this.db.prepare('SELECT id,role,label,created_at,expires_at,used_at FROM invites WHERE token_hash=?').get(tokenHash) as
      | { id: string; role: Role; label: string | null; created_at: number; expires_at: number; used_at: number | null }
      | undefined
    return row
      ? {
          id: row.id,
          role: row.role,
          label: row.label ?? undefined,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
          usedAt: row.used_at ?? undefined,
        }
      : undefined
  }

  // Atomic single-use claim: exactly one concurrent accept can win.
  claimInvite(tokenHash: string, now: number) {
    const row = this.db
      .prepare(
        'UPDATE invites SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>? RETURNING id,role,label,created_at,expires_at,used_at',
      )
      .get(now, tokenHash, now) as
      | { id: string; role: Role; label: string | null; created_at: number; expires_at: number; used_at: number }
      | undefined
    return row
      ? {
          id: row.id,
          role: row.role,
          label: row.label ?? undefined,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
          usedAt: row.used_at,
        }
      : undefined
  }

  completeInvite(id: string, userId: string) {
    this.db.prepare('UPDATE invites SET used_by=? WHERE id=?').run(userId, id)
  }

  deleteInvite(id: string) {
    this.db.prepare('DELETE FROM invites WHERE id=? AND used_at IS NULL').run(id)
  }

  beginOperation(id: string, payload: OperationPayload) {
    if (payload.kind === 'upload') return this.beginUploadOperation(id, payload)
    const now = Date.now()
    try {
      this.db
        .prepare('INSERT INTO operations (id,kind,request_id,payload_json,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, payload.kind, payload.requestId, JSON.stringify(payload), 'prepared', now, now)
    } catch (error) {
      if ((error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE')
        throw new Response('another operation is already running for this request', { status: 409 })
      throw error
    }
  }

  beginUploadOperation(id: string, payload: UploadOperation) {
    const now = Date.now()
    this.db.transaction(() => {
      const completed = this.getCompletedUpload(payload.uploadId, payload.ownerId)
      if (completed) return
      this.db
        .prepare(
          'INSERT OR IGNORE INTO operations (id,kind,request_id,upload_id,payload_json,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
        )
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
      this.insertRequest(payload.requestId, { ...payload.request, filePath: payload.destinationPath })
      this.db
        .prepare('UPDATE upload_sessions SET completed_request_id=?,bytes=0 WHERE id=? AND owner_id=?')
        .run(payload.requestId, payload.uploadId, payload.ownerId)
      this.db.prepare("UPDATE operations SET state='committed',updated_at=? WHERE id=?").run(Date.now(), id)
      return payload.requestId
    })()
  }

  listOperations() {
    return (
      this.db.prepare('SELECT id,state,payload_json FROM operations ORDER BY created_at').all() as {
        id: string
        state: PendingOperation['state']
        payload_json: string
      }[]
    ).map((row) => ({ id: row.id, state: row.state, payload: JSON.parse(row.payload_json) as OperationPayload }))
  }

  finishOperation(id: string) {
    this.db.prepare("DELETE FROM operations WHERE id=? AND state='committed'").run(id)
  }
  abandonOperation(id: string) {
    this.db.prepare('DELETE FROM operations WHERE id=?').run(id)
  }

  private hydrate(row: RequestRow): PrintRequest {
    const states = this.db.prepare('SELECT status_id,quantity,sort_order FROM request_statuses WHERE request_id=?').all(row.id) as {
      status_id: string
      quantity: number
      sort_order: number | null
    }[]
    return {
      id: row.id,
      name: row.name,
      fileName: row.file_name,
      filePath: row.file_path,
      quantity: row.quantity,
      requesterEmail: row.requester_email,
      requesterName: row.requester_name ?? undefined,
      notes: row.notes ?? undefined,
      sourceUrl: row.source_url ?? undefined,
      thumbnailPath: row.thumbnail_path ?? undefined,
      previewPath: row.preview_path ?? undefined,
      hasThumbnail: row.thumbnail_path !== null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      counts: Object.fromEntries(states.map((state) => [state.status_id, state.quantity])),
      orders: Object.fromEntries(states.map((state) => [state.status_id, state.sort_order ?? undefined])),
    }
  }

  private hydrateRows(rows: RequestRow[]): PrintRequest[] {
    if (rows.length === 0) return []
    const placeholders = rows.map(() => '?').join(',')
    const states = this.db
      .prepare(`SELECT request_id,status_id,quantity,sort_order FROM request_statuses WHERE request_id IN (${placeholders})`)
      .all(...rows.map((row) => row.id)) as {
      request_id: string
      status_id: string
      quantity: number
      sort_order: number | null
    }[]
    const byRequest = new Map<string, typeof states>()
    for (const state of states) {
      const current = byRequest.get(state.request_id) ?? []
      current.push(state)
      byRequest.set(state.request_id, current)
    }
    return rows.map((row) => {
      const requestStates = byRequest.get(row.id) ?? []
      return {
        id: row.id,
        name: row.name,
        fileName: row.file_name,
        filePath: row.file_path,
        quantity: row.quantity,
        requesterEmail: row.requester_email,
        requesterName: row.requester_name ?? undefined,
        notes: row.notes ?? undefined,
        sourceUrl: row.source_url ?? undefined,
        thumbnailPath: row.thumbnail_path ?? undefined,
        previewPath: row.preview_path ?? undefined,
        hasThumbnail: row.thumbnail_path !== null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        counts: Object.fromEntries(requestStates.map((state) => [state.status_id, state.quantity])),
        orders: Object.fromEntries(requestStates.map((state) => [state.status_id, state.sort_order ?? undefined])),
      }
    })
  }

  private requestConditions(filters: RequestFilters, query: RequestQuery, options: SqlFilterOptions = {}) {
    const conditions: string[] = []
    const params: unknown[] = []
    const add = (sql: string, ...values: unknown[]) => {
      conditions.push(sql)
      params.push(...values)
    }

    if (query.visibleToEmail) add('r.requester_email = ?', query.visibleToEmail)
    if (options.includeOwner !== false && query.ownerEmail) add('r.requester_email = ?', query.ownerEmail)
    if (filters.query) {
      const pattern = `%${escapeLike(filters.query.toLowerCase())}%`
      const privateMetadata = query.searchPrivateMetadata ? " || ' ' || r.file_name || ' ' || r.requester_email" : ''
      add(
        `(lower(r.id || ' ' || r.name${privateMetadata} || ' ' ||
          coalesce(r.requester_name,'') || ' ' || coalesce(r.notes,'') || ' ' || coalesce(r.source_url,'')) LIKE ? ESCAPE '\\'
          OR EXISTS (
            SELECT 1 FROM request_statuses search_status
             WHERE search_status.request_id = r.id AND search_status.quantity > 0
               AND lower(replace(search_status.status_id, '_', ' ')) LIKE ? ESCAPE '\\'
          ))`,
        pattern,
        pattern,
      )
    }
    if (filters.requester && !options.omitRequester) {
      add(
        `CASE WHEN trim(coalesce(r.requester_name,'')) = '' THEN 'Unknown requester' ELSE r.requester_name END = ? COLLATE NOCASE`,
        filters.requester,
      )
    }
    if (filters.minQuantity !== undefined) add('r.quantity >= ?', filters.minQuantity)
    if (filters.maxQuantity !== undefined) add('r.quantity <= ?', filters.maxQuantity)
    if (filters.createdAfter !== undefined) add('r.created_at >= ?', filters.createdAfter)
    if (filters.createdBefore !== undefined) add('r.created_at <= ?', filters.createdBefore)
    if (filters.updatedAfter !== undefined) add('r.updated_at >= ?', filters.updatedAfter)
    if (filters.updatedBefore !== undefined) add('r.updated_at <= ?', filters.updatedBefore)
    if (filters.hasNotes !== undefined) add(filters.hasNotes ? "trim(coalesce(r.notes,'')) <> ''" : "trim(coalesce(r.notes,'')) = ''")
    if (filters.hasSource !== undefined)
      add(filters.hasSource ? "trim(coalesce(r.source_url,'')) <> ''" : "trim(coalesce(r.source_url,'')) = ''")
    if (filters.hasThumbnail !== undefined) add(filters.hasThumbnail ? 'r.thumbnail_path IS NOT NULL' : 'r.thumbnail_path IS NULL')
    if (filters.hasPreview !== undefined) add(filters.hasPreview ? 'r.preview_path IS NOT NULL' : 'r.preview_path IS NULL')
    return { sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params }
  }

  private insertRequest(id: string, request: NewPrintRequest) {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO requests (id,name,file_name,file_path,quantity,requester_email,requester_name,notes,source_url,thumbnail_path,preview_path,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        request.name,
        request.fileName,
        request.filePath,
        request.quantity,
        request.requesterEmail,
        request.requesterName ?? null,
        request.notes ?? null,
        request.sourceUrl ?? null,
        request.thumbnailPath ?? null,
        request.previewPath ?? null,
        now,
        now,
      )
    const insert = this.db.prepare('INSERT INTO request_statuses (request_id,status_id,quantity) VALUES (?,?,?)')
    for (const status of workflow.statuses) insert.run(id, status.id, status.id === initialStatus().id ? request.quantity : 0)
    const insertJob = this.db.prepare(
      `INSERT INTO asset_generation_jobs(request_id,stage,status,error,queued_at,started_at,finished_at)
       VALUES(?,?,?,NULL,?,NULL,?)`,
    )
    insertJob.run(id, 'thumbnail', request.thumbnailPath ? 'ready' : 'pending', now, request.thumbnailPath ? now : null)
    insertJob.run(id, 'preview', request.previewPath ? 'ready' : 'pending', now, request.previewPath ? now : null)
  }

  private migrate() {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)')
    const applied = new Set(
      (this.db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((row) => row.version),
    )
    for (const migration of migrations)
      if (!applied.has(migration.version))
        this.db.transaction(() => {
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
