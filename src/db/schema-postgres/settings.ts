import { sql } from 'drizzle-orm'
import { bigint, check, primaryKey, pgTable, text } from 'drizzle-orm/pg-core'
import { organization } from './auth'

export const settings = pgTable(
  'settings',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    valueJson: text('value_json').notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.key] })],
)

export const deploymentSettings = pgTable('deployment_settings', {
  key: text().primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
})

export const assetMigrations = pgTable(
  'asset_migrations',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    id: text().notNull(),
    appliedAt: bigint('applied_at', { mode: 'number' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.id] })],
)

export const invites = pgTable(
  'invites',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    role: text({ enum: ['admin', 'requester'] }).notNull(),
    label: text(),
    recipientEmail: text('recipient_email'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
    usedAt: bigint('used_at', { mode: 'number' }),
    usedBy: text('used_by'),
  },
  (table) => [check('invites_role_check', sql`${table.role} IN ('admin', 'requester')`)],
)
