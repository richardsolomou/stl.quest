import { sql } from 'drizzle-orm'
import { bigint, check, foreignKey, index, primaryKey, pgTable, text } from 'drizzle-orm/pg-core'
import { organization } from './auth'
import { requests } from './production'

export const assetGenerationJobs = pgTable(
  'asset_generation_jobs',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    requestId: text('request_id').notNull(),
    stage: text({ enum: ['geometry', 'thumbnail', 'preview'] }).notNull(),
    status: text({ enum: ['pending', 'running', 'ready', 'skipped', 'failed'] }).notNull(),
    error: text(),
    queuedAt: bigint('queued_at', { mode: 'number' }).notNull(),
    startedAt: bigint('started_at', { mode: 'number' }),
    finishedAt: bigint('finished_at', { mode: 'number' }),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.requestId],
      foreignColumns: [requests.workspaceId, requests.id],
      name: 'asset_generation_jobs_workspace_request_fk',
    }).onDelete('cascade'),
    check('asset_generation_jobs_stage_check', sql`${table.stage} IN ('geometry', 'thumbnail', 'preview')`),
    check('asset_generation_jobs_status_check', sql`${table.status} IN ('pending', 'running', 'ready', 'skipped', 'failed')`),
    primaryKey({ columns: [table.workspaceId, table.requestId, table.stage] }),
    index('asset_generation_jobs_workspace_status').on(table.workspaceId, table.status, table.queuedAt),
  ],
)
