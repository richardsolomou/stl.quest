import { sql } from 'drizzle-orm'
import { bigint, check, foreignKey, index, integer, primaryKey, real, pgTable, text, unique, uniqueIndex } from 'drizzle-orm/pg-core'
import { organization, user } from './auth'

export const requests = pgTable(
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
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
    assetsGeneratedAt: bigint('assets_generated_at', { mode: 'number' }),
    printerId: text('printer_id'),
    printType: text('print_type', { enum: ['resin', 'filament'] }),
    automaticPrinterAssignment: integer('automatic_printer_assignment').notNull().default(0),
    modelWidthMm: real('model_width_mm'),
    modelDepthMm: real('model_depth_mm'),
    modelHeightMm: real('model_height_mm'),
  },
  (table) => [
    check('requests_print_type_check', sql`${table.printType} IN ('resin', 'filament') OR ${table.printType} IS NULL`),
    index('requests_created').on(table.createdAt),
    index('requests_workspace_created').on(table.workspaceId, table.createdAt),
    unique('requests_workspace_id_unique').on(table.workspaceId, table.id),
    index('requests_print_type').on(table.printType),
    index('requests_printer_id').on(table.printerId),
    index('requests_owner_user_id').on(table.ownerUserId),
  ],
)

export const requestStatuses = pgTable(
  'request_statuses',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    requestId: text('request_id').notNull(),
    statusId: text('status_id').notNull(),
    quantity: integer().notNull(),
    sortOrder: real('sort_order'),
    completedAt: bigint('completed_at', { mode: 'number' }),
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

export const printGroups = pgTable(
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
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    unique('print_groups_workspace_id_unique').on(table.workspaceId, table.id),
    index('print_groups_status').on(table.workspaceId, table.statusId),
  ],
)

export const printGroupItems = pgTable(
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

export const operations = pgTable(
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
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
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

export const uploadSessions = pgTable(
  'upload_sessions',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    bytes: bigint({ mode: 'number' }).notNull().default(0),
    finalizingBytes: bigint('finalizing_bytes', { mode: 'number' }).notNull().default(0),
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
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

export const managedStorageUsage = pgTable('managed_storage_usage', {
  workspaceId: text('workspace_id')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),
  persistedBytes: bigint('persisted_bytes', { mode: 'number' }).notNull().default(0),
  assetReservedBytes: bigint('asset_reserved_bytes', { mode: 'number' }).notNull().default(0),
})

export const managedStorageAccounts = pgTable('managed_storage_accounts', {
  ownerId: text('owner_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  persistedBytes: bigint('persisted_bytes', { mode: 'number' }).notNull().default(0),
  assetReservedBytes: bigint('asset_reserved_bytes', { mode: 'number' }).notNull().default(0),
})

export const managedStorageEntitlements = pgTable(
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
