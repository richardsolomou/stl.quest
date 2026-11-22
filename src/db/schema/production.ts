import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { organization, user } from './auth'
import { consumables, equipment, printers } from './inventory'

export const requests = sqliteTable(
  'requests',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** Taken from the workspace's `last_request_number` when the request is made, so it makes the request's `SQ-<number>` tag. */
    number: integer('number'),
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
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    assetsGeneratedAt: integer('assets_generated_at'),
    printerId: text('printer_id'),
    printType: text('print_type', { enum: ['resin', 'filament'] }),
    automaticPrinterAssignment: integer('automatic_printer_assignment', { mode: 'boolean' }).notNull().default(false),
    modelWidthMm: real('model_width_mm'),
    modelDepthMm: real('model_depth_mm'),
    modelHeightMm: real('model_height_mm'),
    modelVolumeMm3: real('model_volume_mm3'),
    modelSurfaceAreaMm2: real('model_surface_area_mm2'),
    estimatedMaterialOverride: real('estimated_material_override'),
    estimatedPrintMinutesOverride: real('estimated_print_minutes_override'),
    archivedAt: integer('archived_at'),
    unarchivedAt: integer('unarchived_at'),
    chargedAmount: real('charged_amount'),
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
    uniqueIndex('requests_workspace_id_unique').on(table.workspaceId, table.id),
    uniqueIndex('requests_workspace_number_unique').on(table.workspaceId, table.number),
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
    parentId: text('parent_id'),
    statusId: text('status_id').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('print_groups_workspace_id_unique').on(table.workspaceId, table.id),
    index('print_groups_status').on(table.workspaceId, table.statusId),
    foreignKey({
      columns: [table.workspaceId, table.parentId],
      foreignColumns: [table.workspaceId, table.id],
      name: 'print_groups_workspace_parent_fk',
    }).onDelete('cascade'),
  ],
)

export const printGroupItems = sqliteTable(
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

export const operations = sqliteTable(
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
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
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

/**
 * The append-only usage log (see core/usage). Deleting a printer, equipment, or consumable clears its foreign key here
 * and keeps its name and kind in `deleted_item_name` and `deleted_item_kind` where it was what the event used; request
 * and user IDs are plain text, as deleting a print or an account must not erase the stock and spend it recorded.
 */
export const usageEvents = sqliteTable(
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
    amount: real().notNull(),
    unit: text({ enum: ['ml', 'g', 'item', 'minute', 'plate'] }).notNull(),
    copies: integer(),
    outcome: text({ enum: ['completed', 'failed'] }),
    unitPrice: real('unit_price'),
    currency: text(),
    estimated: integer({ mode: 'boolean' }).notNull().default(false),
    userId: text('user_id'),
    createdAt: integer('created_at').notNull(),
    undoneAt: integer('undone_at'),
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
    index('usage_events_printer').on(table.workspaceId, table.printerId),
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
 * A plate started from the board runs: `status_id` is the stage its copies move through together, null once the run is
 * over. It keeps the usage transaction it recorded so a new upload replaces it.
 */
export const plates = sqliteTable(
  'plates',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    number: integer().notNull(),
    printerId: text('printer_id'),
    otherStuff: integer('other_stuff', { mode: 'boolean' }).notNull().default(false),
    transactionId: text('transaction_id'),
    source: text({ enum: ['file', 'totals', 'printer'] }),
    method: text({ enum: ['measured', 'volume', 'estimate', 'even'] }),
    unit: text({ enum: ['g', 'ml'] }),
    minutes: real(),
    otherAmount: real('other_amount'),
    overheadAmount: real('overhead_amount'),
    recordedAt: integer('recorded_at'),
    statusId: text('status_id', { enum: ['in_progress', 'post_processing'] }),
    startedAt: integer('started_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('plates_workspace_id_unique').on(table.workspaceId, table.id),
    uniqueIndex('plates_workspace_number_unique').on(table.workspaceId, table.number),
    check('plates_source_check', sql`${table.source} IN ('file', 'totals', 'printer') OR ${table.source} IS NULL`),
    check('plates_status_check', sql`${table.statusId} IN ('in_progress', 'post_processing') OR ${table.statusId} IS NULL`),
    index('plates_status').on(table.workspaceId, table.statusId),
    check('plates_method_check', sql`${table.method} IN ('measured', 'volume', 'estimate', 'even') OR ${table.method} IS NULL`),
    check('plates_unit_check', sql`${table.unit} IN ('g', 'ml') OR ${table.unit} IS NULL`),
    foreignKey({
      columns: [table.workspaceId, table.printerId],
      foreignColumns: [printers.workspaceId, printers.id],
      name: 'plates_workspace_printer_fk',
    }),
  ],
)

export const plateItems = sqliteTable(
  'plate_items',
  {
    workspaceId: text('workspace_id').notNull(),
    plateId: text('plate_id').notNull(),
    requestId: text('request_id').notNull(),
    copies: integer().notNull(),
    amount: real(),
    minutes: real(),
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

/**
 * Prints a printer reported running, through Bambuddy's webhook (see core/printJobs). Each links to the plate run it
 * was, or waits unlinked until someone attaches it or marks it personal; deleting a plate unlinks its prints first.
 */
export const printJobs = sqliteTable(
  'print_jobs',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    printerName: text('printer_name').notNull(),
    printerId: text('printer_id'),
    fileName: text('file_name'),
    outcome: text({ enum: ['printing', 'finished', 'failed', 'cancelled'] }).notNull(),
    minutes: real(),
    grams: real(),
    filamentDetails: text('filament_details'),
    /** JSON: what the print used per Spoolman spool, as `PrintSpoolUsage[]`. */
    filamentUsage: text('filament_usage'),
    reason: text(),
    progress: real(),
    archiveId: text('archive_id'),
    runId: text('run_id'),
    plateId: text('plate_id'),
    personal: integer('personal', { mode: 'boolean' }).notNull().default(false),
    transactionId: text('transaction_id'),
    startedAt: integer('started_at'),
    endedAt: integer('ended_at'),
    receivedAt: integer('received_at').notNull(),
  },
  (table) => [
    uniqueIndex('print_jobs_workspace_id_unique').on(table.workspaceId, table.id),
    index('print_jobs_received').on(table.workspaceId, table.receivedAt),
    index('print_jobs_plate').on(table.workspaceId, table.plateId),
    check('print_jobs_outcome_check', sql`${table.outcome} IN ('printing', 'finished', 'failed', 'cancelled')`),
    foreignKey({
      columns: [table.workspaceId, table.printerId],
      foreignColumns: [printers.workspaceId, printers.id],
      name: 'print_jobs_workspace_printer_fk',
    }),
    foreignKey({
      columns: [table.workspaceId, table.plateId],
      foreignColumns: [plates.workspaceId, plates.id],
      name: 'print_jobs_workspace_plate_fk',
    }),
  ],
)
