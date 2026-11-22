import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { organization, user } from './auth'
import { consumables, equipment, printers } from './inventory'

export const requests = pgTable(
  'requests',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    fileName: text('file_name'),
    filePath: text('file_path'),
    quantity: integer().notNull(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    notes: text(),
    sourceUrl: text('source_url'),
    sourceImageUrl: text('source_image_url'),
    sourceImagePath: text('source_image_path'),
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
    modelVolumeMm3: real('model_volume_mm3'),
    modelSurfaceAreaMm2: real('model_surface_area_mm2'),
    estimatedMaterialOverride: real('estimated_material_override'),
    estimatedPrintMinutesOverride: real('estimated_print_minutes_override'),
    archivedAt: bigint('archived_at', { mode: 'number' }),
    unarchivedAt: bigint('unarchived_at', { mode: 'number' }),
    chargedAmount: doublePrecision('charged_amount'),
    chargedCurrency: text('charged_currency'),
  },
  (table) => [
    check('requests_print_type_check', sql`${table.printType} IN ('resin', 'filament') OR ${table.printType} IS NULL`),
    check(
      'requests_model_source_check',
      sql`(${table.fileName} IS NOT NULL AND ${table.filePath} IS NOT NULL) OR (${table.fileName} IS NULL AND ${table.filePath} IS NULL AND trim(coalesce(${table.sourceUrl}, '')) <> '')`,
    ),
    index('requests_created').on(table.createdAt),
    index('requests_workspace_created').on(table.workspaceId, table.createdAt),
    unique('requests_workspace_id_unique').on(table.workspaceId, table.id),
    index('requests_print_type').on(table.printType),
    index('requests_printer_id').on(table.printerId),
    index('requests_owner_user_id').on(table.ownerUserId),
    foreignKey({
      columns: [table.workspaceId, table.printerId],
      foreignColumns: [printers.workspaceId, printers.id],
      name: 'requests_workspace_printer_fk',
    }),
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
    parentId: text('parent_id'),
    statusId: text('status_id').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    unique('print_groups_workspace_id_unique').on(table.workspaceId, table.id),
    index('print_groups_status').on(table.workspaceId, table.statusId),
    foreignKey({
      columns: [table.workspaceId, table.parentId],
      foreignColumns: [table.workspaceId, table.id],
      name: 'print_groups_workspace_parent_fk',
    }).onDelete('cascade'),
  ],
)

export const printGroupItems = pgTable(
  'print_group_items',
  {
    workspaceId: text('workspace_id').notNull(),
    groupId: text('group_id').notNull(),
    requestId: text('request_id').notNull(),
    statusId: text('status_id').notNull(),
    quantity: integer().notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.groupId, table.requestId, table.statusId] }),
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
    kind: text({ enum: ['move', 'delete', 'upload', 'attach', 'repeat'] }).notNull(),
    requestId: text('request_id'),
    uploadId: text('upload_id'),
    payloadJson: text('payload_json').notNull(),
    state: text({ enum: ['prepared', 'assets_moved', 'committed'] }).notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    check('operations_kind_check', sql`${table.kind} IN ('move', 'delete', 'upload', 'attach', 'repeat')`),
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

/**
 * The append-only usage log (see core/usage). Deleting a printer, equipment, or consumable clears its foreign key here
 * and keeps its name and kind in `deleted_item_name` and `deleted_item_kind` where it was what the event used; request
 * and user IDs are plain text, as deleting a print or an account must not erase the stock and spend it recorded.
 */
export const usageEvents = pgTable(
  'usage_events',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    transactionId: text('transaction_id').notNull(),
    stage: text({ enum: ['printing', 'finishing', 'stock'] }).notNull(),
    kind: text({ enum: ['use', 'restock', 'correction', 'waste', 'replace'] }).notNull(),
    requestId: text('request_id'),
    printerId: text('printer_id'),
    equipmentId: text('equipment_id'),
    consumableId: text('consumable_id'),
    amount: doublePrecision().notNull(),
    unit: text({ enum: ['ml', 'g', 'item', 'minute', 'plate'] }).notNull(),
    copies: integer(),
    outcome: text({ enum: ['completed', 'failed'] }),
    unitPrice: doublePrecision('unit_price'),
    currency: text(),
    estimated: integer().notNull().default(0),
    userId: text('user_id'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    undoneAt: bigint('undone_at', { mode: 'number' }),
    plateId: text('plate_id'),
    supersededBy: text('superseded_by'),
    deletedItemName: text('deleted_item_name'),
    deletedItemKind: text('deleted_item_kind', { enum: ['printer', 'equipment', 'resin', 'filament', 'part', 'supply'] }),
  },
  (table) => [
    check('usage_events_stage_check', sql`${table.stage} IN ('printing', 'finishing', 'stock')`),
    check('usage_events_kind_check', sql`${table.kind} IN ('use', 'restock', 'correction', 'waste', 'replace')`),
    check('usage_events_unit_check', sql`${table.unit} IN ('ml', 'g', 'item', 'minute', 'plate')`),
    check('usage_events_outcome_check', sql`${table.outcome} IN ('completed', 'failed') OR ${table.outcome} IS NULL`),
    check('usage_events_copies_check', sql`${table.copies} > 0 OR ${table.copies} IS NULL`),
    check(
      'usage_events_deleted_item_kind_check',
      sql`${table.deletedItemKind} IN ('printer', 'equipment', 'resin', 'filament', 'part', 'supply') OR ${table.deletedItemKind} IS NULL`,
    ),
    index('usage_events_request').on(table.workspaceId, table.requestId),
    index('usage_events_consumable').on(table.workspaceId, table.consumableId),
    index('usage_events_transaction').on(table.workspaceId, table.transactionId),
    index('usage_events_created').on(table.workspaceId, table.createdAt),
    index('usage_events_superseded').on(table.workspaceId, table.supersededBy),
    foreignKey({
      columns: [table.workspaceId, table.printerId],
      foreignColumns: [printers.workspaceId, printers.id],
      name: 'usage_events_workspace_printer_fk',
    }),
    foreignKey({
      columns: [table.workspaceId, table.equipmentId],
      foreignColumns: [equipment.workspaceId, equipment.id],
      name: 'usage_events_workspace_equipment_fk',
    }),
    foreignKey({
      columns: [table.workspaceId, table.consumableId],
      foreignColumns: [consumables.workspaceId, consumables.id],
      name: 'usage_events_workspace_consumable_fk',
    }),
  ],
)

/**
 * What went on one run of a printer, so the slicer's totals for the run can be split across its prints (see core/plates).
 * A plate is a record, not a board stage: its prints move as before, and it keeps the usage transaction it recorded so a
 * new upload replaces it.
 */
export const plates = pgTable(
  'plates',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    number: integer().notNull(),
    printerId: text('printer_id'),
    otherStuff: integer('other_stuff').notNull().default(0),
    transactionId: text('transaction_id'),
    source: text({ enum: ['file', 'totals'] }),
    method: text({ enum: ['measured', 'volume', 'estimate', 'even'] }),
    unit: text({ enum: ['g', 'ml'] }),
    minutes: doublePrecision(),
    otherAmount: doublePrecision('other_amount'),
    overheadAmount: doublePrecision('overhead_amount'),
    recordedAt: bigint('recorded_at', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    unique('plates_workspace_id_unique').on(table.workspaceId, table.id),
    unique('plates_workspace_number_unique').on(table.workspaceId, table.number),
    check('plates_source_check', sql`${table.source} IN ('file', 'totals') OR ${table.source} IS NULL`),
    check('plates_method_check', sql`${table.method} IN ('measured', 'volume', 'estimate', 'even') OR ${table.method} IS NULL`),
    check('plates_unit_check', sql`${table.unit} IN ('g', 'ml') OR ${table.unit} IS NULL`),
    foreignKey({
      columns: [table.workspaceId, table.printerId],
      foreignColumns: [printers.workspaceId, printers.id],
      name: 'plates_workspace_printer_fk',
    }),
  ],
)

export const plateItems = pgTable(
  'plate_items',
  {
    workspaceId: text('workspace_id').notNull(),
    plateId: text('plate_id').notNull(),
    requestId: text('request_id').notNull(),
    copies: integer().notNull(),
    amount: doublePrecision(),
    minutes: doublePrecision(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.plateId, table.requestId] }),
    index('plate_items_request').on(table.workspaceId, table.requestId),
    foreignKey({
      columns: [table.workspaceId, table.plateId],
      foreignColumns: [plates.workspaceId, plates.id],
      name: 'plate_items_workspace_plate_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.workspaceId, table.requestId],
      foreignColumns: [requests.workspaceId, requests.id],
      name: 'plate_items_workspace_request_fk',
    }).onDelete('cascade'),
    check('plate_items_copies_check', sql`${table.copies} > 0`),
  ],
)
