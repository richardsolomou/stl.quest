import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { organization } from './auth'
import { requests } from './production'

export const plateModelAnalysis = sqliteTable(
  'plate_model_analysis',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    requestId: text('request_id').notNull(),
    widthMm: real('width_mm').notNull(),
    depthMm: real('depth_mm').notNull(),
    heightMm: real('height_mm').notNull(),
    analyzedAt: integer('analyzed_at').notNull(),
    orientationQuaternion: text('orientation_quaternion'),
    orientationIslandCount: integer('orientation_island_count'),
    orientationRisk: real('orientation_risk'),
    orientationCandidates: text('orientation_candidates'),
    contentHash: text('content_hash'),
    analysisVersion: integer('analysis_version').notNull().default(1),
    estimatedVolumeMm3: real('estimated_volume_mm3'),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.requestId] }),
    foreignKey({
      columns: [table.workspaceId, table.requestId],
      foreignColumns: [requests.workspaceId, requests.id],
      name: 'plate_model_analysis_workspace_request_fk',
    }).onDelete('cascade'),
    index('plate_model_analysis_workspace_content_hash').on(table.workspaceId, table.contentHash),
  ],
)

export const orientationAnalysisJobs = sqliteTable(
  'orientation_analysis_jobs',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    requestId: text('request_id').notNull(),
    status: text({ enum: ['pending', 'running', 'ready', 'failed'] }).notNull(),
    analysisVersion: integer('analysis_version').notNull(),
    error: text(),
    queuedAt: integer('queued_at').notNull(),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.requestId] }),
    foreignKey({
      columns: [table.workspaceId, table.requestId],
      foreignColumns: [requests.workspaceId, requests.id],
      name: 'orientation_analysis_jobs_workspace_request_fk',
    }).onDelete('cascade'),
    check('orientation_analysis_jobs_status_check', sql`${table.status} IN ('pending', 'running', 'ready', 'failed')`),
    index('orientation_analysis_jobs_workspace_status').on(table.workspaceId, table.status, table.queuedAt),
  ],
)

export const assetGenerationJobs = sqliteTable(
  'asset_generation_jobs',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    requestId: text('request_id').notNull(),
    stage: text({ enum: ['thumbnail', 'preview'] }).notNull(),
    status: text({ enum: ['pending', 'running', 'ready', 'skipped', 'failed'] }).notNull(),
    error: text(),
    queuedAt: integer('queued_at').notNull(),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.requestId],
      foreignColumns: [requests.workspaceId, requests.id],
      name: 'asset_generation_jobs_workspace_request_fk',
    }).onDelete('cascade'),
    check('asset_generation_jobs_stage_check', sql`${table.stage} IN ('thumbnail', 'preview')`),
    check('asset_generation_jobs_status_check', sql`${table.status} IN ('pending', 'running', 'ready', 'skipped', 'failed')`),
    primaryKey({ columns: [table.workspaceId, table.requestId, table.stage] }),
    index('asset_generation_jobs_workspace_status').on(table.workspaceId, table.status, table.queuedAt),
  ],
)
