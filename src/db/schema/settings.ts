import { sql } from 'drizzle-orm'
import { check, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { organization } from './auth'

export const settings = sqliteTable(
  'settings',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    valueJson: text('value_json').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.key] })],
)

export const deploymentSettings = sqliteTable('deployment_settings', {
  key: text().primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const invites = sqliteTable(
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
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    usedAt: integer('used_at'),
    usedBy: text('used_by'),
  },
  (table) => [check('invites_role_check', sql`${table.role} IN ('admin', 'requester')`)],
)
