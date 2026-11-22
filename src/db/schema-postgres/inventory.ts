import { sql } from 'drizzle-orm'
import { bigint, check, doublePrecision, foreignKey, index, integer, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { organization } from './auth'

/**
 * What a workspace owns. IDs are chosen by the browser, so they are unique only within a workspace; `position` keeps
 * the order items were added in, which picks a quote's default material, and `archived_at` takes an item out of use
 * while the prints and usage that reference it keep resolving it. Only an archived item is deleted, and deleting it
 * unlinks those references first (see `Repository.deleteInventoryItem`).
 */
export const printers = pgTable(
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
    widthMm: doublePrecision('width_mm'),
    depthMm: doublePrecision('depth_mm'),
    heightMm: doublePrecision('height_mm'),
    purchasePrice: doublePrecision('purchase_price'),
    lifespanHours: doublePrecision('lifespan_hours'),
    purchasedOn: text('purchased_on'),
    powerWatts: doublePrecision('power_watts'),
    addOnPresetIdsJson: text('add_on_preset_ids_json').notNull().default('[]'),
    slicer: text('slicer'),
    archivedAt: bigint('archived_at', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    check('printers_print_type_check', sql`${table.printType} IN ('resin', 'filament')`),
    index('printers_position').on(table.workspaceId, table.position),
  ],
)

export const equipment = pgTable(
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
    powerWatts: doublePrecision('power_watts').notNull(),
    minutesPerUse: doublePrecision('minutes_per_use').notNull(),
    suppliesJson: text('supplies_json').notNull().default('[]'),
    purchasePrice: doublePrecision('purchase_price'),
    lifespanHours: doublePrecision('lifespan_hours'),
    purchasedOn: text('purchased_on'),
    archivedAt: bigint('archived_at', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
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
export const stores = pgTable(
  'stores',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    id: text().notNull(),
    position: integer().notNull(),
    name: text().notNull(),
    shippingCost: doublePrecision('shipping_cost'),
    freeShippingOver: doublePrecision('free_shipping_over'),
    currency: text(),
    exchangeRate: doublePrecision('exchange_rate'),
    usualOrder: doublePrecision('usual_order'),
    url: text(),
    archivedAt: bigint('archived_at', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.id] }), index('stores_position').on(table.workspaceId, table.position)],
)

/**
 * Resins, filaments, wear parts, and supplies in one table: `price` is per litre, per kilogram, or per unit as the kind
 * is bought, `preset_id` is the resin, filament, part, or supply catalogue entry, and the remaining columns belong to one kind.
 * A part's `printer_id` is the custom printer it belongs to; it has no foreign key, since a part may name a printer that
 * no longer exists, which the library shows as a group of its own.
 */
export const consumables = pgTable(
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
    price: doublePrecision().notNull(),
    densityGramsPerMl: doublePrecision('density_grams_per_ml'),
    colourJson: text('colour_json'),
    printType: text('print_type', { enum: ['resin', 'filament'] }),
    lifespan: doublePrecision(),
    lifespanUnit: text('lifespan_unit', { enum: ['plates', 'hours'] }),
    printerPresetId: text('printer_preset_id'),
    printerId: text('printer_id'),
    unit: text({ enum: ['ml', 'g', 'item'] }),
    /** A resin or filament's own slicer, used instead of its printer's. */
    slicer: text('slicer'),
    minimumStock: doublePrecision('minimum_stock'),
    packSize: doublePrecision('pack_size'),
    storeId: text('store_id'),
    archivedAt: bigint('archived_at', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
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

/** A workspace's Spoolman connection: the hash of the write-only token its bridge or other tools send spools with. */
export const spoolmanConnections = pgTable('spoolman_connections', {
  workspaceId: text('workspace_id')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  receivedAt: bigint('received_at', { mode: 'number' }),
})

/** The spools Spoolman last sent, each with its filament as Spoolman describes it; they go when the connection does. */
export const spoolmanSpools = pgTable(
  'spoolman_spools',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => spoolmanConnections.workspaceId, { onDelete: 'cascade' }),
    id: integer().notNull(),
    filamentId: integer('filament_id').notNull(),
    filamentName: text('filament_name'),
    vendor: text(),
    material: text(),
    colourHex: text('colour_hex'),
    externalId: text('external_id'),
    remainingGrams: doublePrecision('remaining_grams'),
    archived: integer().notNull().default(0),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.id] })],
)

/**
 * Which library filament a Spoolman filament is, when someone chose it rather than leaving it to matching; no
 * consumable means it is deliberately linked to none. Links outlive the connection, so reconnecting keeps them.
 */
export const spoolmanLinks = pgTable(
  'spoolman_links',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    filamentId: integer('filament_id').notNull(),
    consumableId: text('consumable_id'),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.filamentId] }),
    foreignKey({
      columns: [table.workspaceId, table.consumableId],
      foreignColumns: [consumables.workspaceId, consumables.id],
      name: 'spoolman_links_workspace_consumable_fk',
    }).onDelete('cascade'),
  ],
)
