import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { organization } from './auth'

/**
 * What a workspace owns. IDs are chosen by the browser, so they are unique only within a workspace; `position` keeps
 * the order items were added in, which picks a quote's default material, and `archived_at` takes an item out of use
 * while the prints and usage that reference it keep resolving it. Only an archived item is deleted, and deleting it
 * unlinks those references first (see `Repository.deleteInventoryItem`).
 */
export const printers = sqliteTable(
  'printers',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    id: text().notNull(),
    position: integer().notNull(),
    name: text().notNull(),
    printType: text('print_type', { enum: ['resin', 'filament'] }).notNull(),
    presetId: text('preset_id'),
    widthMm: real('width_mm'),
    depthMm: real('depth_mm'),
    heightMm: real('height_mm'),
    purchasePrice: real('purchase_price'),
    lifespanHours: real('lifespan_hours'),
    purchasedOn: text('purchased_on'),
    powerWatts: real('power_watts'),
    addOnPresetIdsJson: text('add_on_preset_ids_json').notNull().default('[]'),
    archivedAt: integer('archived_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    check('printers_print_type_check', sql`${table.printType} IN ('resin', 'filament')`),
    index('printers_position').on(table.workspaceId, table.position),
  ],
)

export const equipment = sqliteTable(
  'equipment',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    id: text().notNull(),
    position: integer().notNull(),
    name: text().notNull(),
    presetId: text('preset_id'),
    kind: text({ enum: ['wash', 'cure', 'wash-cure', 'oven', 'ultrasonic', 'dryer', 'other'] }).notNull(),
    stage: text({ enum: ['before-printing', 'finishing'] }).notNull(),
    printType: text('print_type', { enum: ['resin', 'filament'] }),
    powerWatts: real('power_watts').notNull(),
    minutesPerUse: real('minutes_per_use').notNull(),
    suppliesJson: text('supplies_json').notNull().default('[]'),
    purchasePrice: real('purchase_price'),
    lifespanHours: real('lifespan_hours'),
    purchasedOn: text('purchased_on'),
    archivedAt: integer('archived_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    check('equipment_kind_check', sql`${table.kind} IN ('wash', 'cure', 'wash-cure', 'oven', 'ultrasonic', 'dryer', 'other')`),
    check('equipment_stage_check', sql`${table.stage} IN ('before-printing', 'finishing')`),
    check('equipment_print_type_check', sql`${table.printType} IN ('resin', 'filament') OR ${table.printType} IS NULL`),
    index('equipment_position').on(table.workspaceId, table.position),
  ],
)

/** Where consumables are bought, with what an order costs to ship and the order total that ships free. */
export const stores = sqliteTable(
  'stores',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    id: text().notNull(),
    position: integer().notNull(),
    name: text().notNull(),
    shippingCost: real('shipping_cost'),
    freeShippingOver: real('free_shipping_over'),
    archivedAt: integer('archived_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.id] }), index('stores_position').on(table.workspaceId, table.position)],
)

/**
 * Resins, filaments, wear parts, and supplies in one table: `price` is per litre, per kilogram, or per unit as the kind
 * is bought, `preset_id` is the resin, filament, part, or supply catalogue entry, and the remaining columns belong to one kind.
 * A part's `printer_id` is the custom printer it belongs to; it has no foreign key, since a part may name a printer that
 * no longer exists, which the library shows as a group of its own.
 */
export const consumables = sqliteTable(
  'consumables',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    id: text().notNull(),
    position: integer().notNull(),
    kind: text({ enum: ['resin', 'filament', 'part', 'supply'] }).notNull(),
    name: text().notNull(),
    presetId: text('preset_id'),
    price: real().notNull(),
    densityGramsPerMl: real('density_grams_per_ml'),
    colourJson: text('colour_json'),
    printType: text('print_type', { enum: ['resin', 'filament'] }),
    lifespan: real(),
    lifespanUnit: text('lifespan_unit', { enum: ['plates', 'hours'] }),
    printerPresetId: text('printer_preset_id'),
    printerId: text('printer_id'),
    unit: text({ enum: ['ml', 'g', 'item'] }),
    minimumStock: real('minimum_stock'),
    packSize: real('pack_size'),
    storeId: text('store_id'),
    archivedAt: integer('archived_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    check('consumables_kind_check', sql`${table.kind} IN ('resin', 'filament', 'part', 'supply')`),
    check('consumables_print_type_check', sql`${table.printType} IN ('resin', 'filament') OR ${table.printType} IS NULL`),
    check('consumables_lifespan_unit_check', sql`${table.lifespanUnit} IN ('plates', 'hours') OR ${table.lifespanUnit} IS NULL`),
    check('consumables_unit_check', sql`${table.unit} IN ('ml', 'g', 'item') OR ${table.unit} IS NULL`),
    index('consumables_position').on(table.workspaceId, table.position),
    foreignKey({
      columns: [table.workspaceId, table.storeId],
      foreignColumns: [stores.workspaceId, stores.id],
      name: 'consumables_workspace_store_fk',
    }),
  ],
)
