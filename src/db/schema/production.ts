import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { organization, user } from './auth'

export const requests = sqliteTable(
  'requests',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    fileName: text('file_name').notNull(),
    filePath: text('file_path').notNull(),
    quantity: integer().notNull(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    notes: text(),
    sourceUrl: text('source_url'),
    thumbnailPath: text('thumbnail_path'),
    previewPath: text('preview_path'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    assetsGeneratedAt: integer('assets_generated_at'),
    printerId: text('printer_id'),
    printType: text('print_type', { enum: ['resin', 'filament'] }),
    automaticPrinterAssignment: integer('automatic_printer_assignment', { mode: 'boolean' }).notNull().default(false),
    modelWidthMm: real('model_width_mm'),
    modelDepthMm: real('model_depth_mm'),
    modelHeightMm: real('model_height_mm'),
  },
  (table) => [
    check('requests_print_type_check', sql`${table.printType} IN ('resin', 'filament') OR ${table.printType} IS NULL`),
    index('requests_created').on(table.createdAt),
    index('requests_workspace_created').on(table.workspaceId, table.createdAt),
    uniqueIndex('requests_workspace_id_unique').on(table.workspaceId, table.id),
    index('requests_print_type').on(table.printType),
    index('requests_printer_id').on(table.printerId),
    index('requests_owner_user_id').on(table.ownerUserId),
  ],
)

export const requestStatuses = sqliteTable(
  'request_statuses',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    requestId: text('request_id').notNull(),
    statusId: text('status_id').notNull(),
    quantity: integer().notNull(),
    sortOrder: real('sort_order'),
    completedAt: integer('completed_at'),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.requestId, table.statusId] }),
    foreignKey({
      columns: [table.workspaceId, table.requestId],
      foreignColumns: [requests.workspaceId, requests.id],
      name: 'request_statuses_workspace_request_fk',
    }).onDelete('cascade'),
  ],
)

export const printGroups = sqliteTable(
  'print_groups',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    color: text({ enum: ['blue', 'green', 'amber', 'violet', 'rose', 'cyan', 'orange', 'lime', 'fuchsia', 'sky', 'teal', 'indigo'] })
      .notNull()
      .default('blue'),
    statusId: text('status_id').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('print_groups_workspace_id_unique').on(table.workspaceId, table.id),
    index('print_groups_status').on(table.workspaceId, table.statusId),
  ],
)

export const printGroupItems = sqliteTable(
  'print_group_items',
  {
    workspaceId: text('workspace_id').notNull(),
    groupId: text('group_id').notNull(),
    requestId: text('request_id').notNull(),
    quantity: integer().notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.groupId, table.requestId] }),
    foreignKey({
      columns: [table.workspaceId, table.groupId],
      foreignColumns: [printGroups.workspaceId, printGroups.id],
      name: 'print_group_items_workspace_group_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.workspaceId, table.requestId],
      foreignColumns: [requests.workspaceId, requests.id],
      name: 'print_group_items_workspace_request_fk',
    }).onDelete('cascade'),
    check('print_group_items_quantity_check', sql`${table.quantity} > 0`),
  ],
)

export const operations = sqliteTable(
  'operations',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    kind: text({ enum: ['move', 'delete', 'upload', 'repeat'] }).notNull(),
    requestId: text('request_id'),
    uploadId: text('upload_id'),
    payloadJson: text('payload_json').notNull(),
    state: text({ enum: ['prepared', 'assets_moved', 'committed'] }).notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    check('operations_kind_check', sql`${table.kind} IN ('move', 'delete', 'upload', 'repeat')`),
    check('operations_state_check', sql`${table.state} IN ('prepared', 'assets_moved', 'committed')`),
    index('operations_state').on(table.state, table.createdAt),
    uniqueIndex('operations_active_request')
      .on(table.workspaceId, table.requestId)
      .where(sql`${table.requestId} IS NOT NULL AND ${table.state} <> 'committed'`),
    uniqueIndex('operations_upload')
      .on(table.workspaceId, table.uploadId)
      .where(sql`${table.uploadId} IS NOT NULL`),
  ],
)

export const uploadSessions = sqliteTable(
  'upload_sessions',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    bytes: integer().notNull().default(0),
    finalizingBytes: integer('finalizing_bytes').notNull().default(0),
    expiresAt: integer('expires_at').notNull(),
    completedRequestId: text('completed_request_id'),
  },
  (table) => [
    index('upload_sessions_owner').on(table.workspaceId, table.ownerId, table.expiresAt),
    foreignKey({
      columns: [table.workspaceId, table.completedRequestId],
      foreignColumns: [requests.workspaceId, requests.id],
      name: 'upload_sessions_workspace_request_fk',
    }).onDelete('cascade'),
  ],
)

export const managedStorageUsage = sqliteTable('managed_storage_usage', {
  workspaceId: text('workspace_id')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),
  persistedBytes: integer('persisted_bytes').notNull().default(0),
  assetReservedBytes: integer('asset_reserved_bytes').notNull().default(0),
})

export const managedStorageAccounts = sqliteTable('managed_storage_accounts', {
  ownerId: text('owner_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  persistedBytes: integer('persisted_bytes').notNull().default(0),
  assetReservedBytes: integer('asset_reserved_bytes').notNull().default(0),
})

export const managedStorageEntitlements = sqliteTable(
  'managed_storage_entitlements',
  {
    workspaceId: text('workspace_id')
      .primaryKey()
      .references(() => organization.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id')
      .notNull()
      .references(() => managedStorageAccounts.ownerId, { onDelete: 'cascade' }),
  },
  (table) => [index('managed_storage_entitlements_owner').on(table.ownerId)],
)
