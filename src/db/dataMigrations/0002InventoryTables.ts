import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { normalizePrinterProfile } from '../../core/printers'
import type { PrinterProfile } from '../../core/types'
import type { DataMigration, MigrationLog, MigrationTransaction } from './types'

const settings = sqliteTable('settings', {
  workspaceId: text('workspace_id').notNull(),
  key: text().notNull(),
  valueJson: text('value_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
})
const requests = sqliteTable('requests', {
  workspaceId: text('workspace_id').notNull(),
  printerId: text('printer_id'),
})
const usageEvents = sqliteTable('usage_events', {
  workspaceId: text('workspace_id').notNull(),
  printerId: text('printer_id'),
  equipmentId: text('equipment_id'),
  consumableId: text('consumable_id'),
})
const timestamps = {
  archivedAt: integer('archived_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}
const printers = sqliteTable('printers', {
  workspaceId: text('workspace_id').notNull(),
  id: text().notNull(),
  position: integer().notNull(),
  name: text().notNull(),
  printType: text('print_type').notNull(),
  presetId: text('preset_id'),
  widthMm: real('width_mm'),
  depthMm: real('depth_mm'),
  heightMm: real('height_mm'),
  purchasePrice: real('purchase_price'),
  lifespanHours: real('lifespan_hours'),
  powerWatts: real('power_watts'),
  addOnPresetIdsJson: text('add_on_preset_ids_json').notNull(),
  ...timestamps,
})
const equipment = sqliteTable('equipment', {
  workspaceId: text('workspace_id').notNull(),
  id: text().notNull(),
  position: integer().notNull(),
  name: text().notNull(),
  presetId: text('preset_id'),
  kind: text().notNull(),
  stage: text().notNull(),
  printType: text('print_type'),
  powerWatts: real('power_watts').notNull(),
  minutesPerUse: real('minutes_per_use').notNull(),
  suppliesJson: text('supplies_json').notNull(),
  purchasePrice: real('purchase_price'),
  lifespanHours: real('lifespan_hours'),
  ...timestamps,
})
const consumables = sqliteTable('consumables', {
  workspaceId: text('workspace_id').notNull(),
  id: text().notNull(),
  position: integer().notNull(),
  kind: text().notNull(),
  name: text().notNull(),
  presetId: text('preset_id'),
  price: real().notNull(),
  densityGramsPerMl: real('density_grams_per_ml'),
  colourJson: text('colour_json'),
  printType: text('print_type'),
  lifespan: real(),
  lifespanUnit: text('lifespan_unit'),
  printerPresetId: text('printer_preset_id'),
  printerId: text('printer_id'),
  unit: text(),
  minimumStock: real('minimum_stock'),
  packSize: real('pack_size'),
  ...timestamps,
})

const PRINTERS = 'printers'
const EQUIPMENT = 'equipment'
const CONSUMABLES = 'consumables'
const PRINTERS_SKIPPED = 'printers-skipped'
const PRINT_TYPES = new Set(['resin', 'filament'])
const EQUIPMENT_KINDS = new Set(['wash', 'cure', 'wash-cure', 'oven', 'ultrasonic', 'dryer', 'other'])
const EQUIPMENT_STAGES = new Set(['before-printing', 'finishing'])
const SUPPLY_UNITS = new Set(['ml', 'g', 'item'])

type Stored = Record<string, unknown>
type Row<Table extends typeof printers | typeof equipment | typeof consumables> = Omit<
  Table['$inferInsert'],
  'workspaceId' | 'id' | 'position' | 'createdAt' | 'updatedAt'
>

/**
 * Copies each workspace's printers, equipment, and consumables out of settings JSON into their own tables, in their
 * stored order, then removes the settings. Prints and usage that name an item the JSON no longer held lose that
 * reference, which is logged, so the foreign keys the next schema migration adds hold. A workspace that saved an empty
 * printer list during setup keeps that choice as `printers-skipped`.
 */
export const inventoryTablesMigration: DataMigration = {
  id: '0002_inventory_tables',
  after: 'inventory',
  async run(database, log) {
    const now = Date.now()
    const rows = await database
      .select()
      .from(settings)
      .where(inArray(settings.key, [PRINTERS, EQUIPMENT, CONSUMABLES]))
      .all()
    const stored = new Map<string, Record<string, unknown[]>>()
    for (const row of rows) {
      const parsed: unknown = JSON.parse(row.valueJson)
      stored.set(row.workspaceId, { ...stored.get(row.workspaceId), [row.key]: Array.isArray(parsed) ? parsed : [] })
    }
    const kept = {
      printers: new Map<string, Set<string>>(),
      equipment: new Map<string, Set<string>>(),
      consumables: new Map<string, Set<string>>(),
    }
    for (const [workspaceId, lists] of stored) {
      const copy = async <Table extends typeof printers | typeof equipment | typeof consumables>(
        table: Table,
        key: keyof typeof kept,
        toRow: (item: Stored) => Row<Table> | undefined,
      ) => {
        const ids = new Set<string>()
        for (const item of (lists[key] ?? []) as Stored[]) {
          const id = typeof item?.id === 'string' ? item.id : undefined
          const row = id && !ids.has(id) && typeof item.name === 'string' ? toRow(item) : undefined
          if (!id || !row) {
            log.warn(
              { event: 'data_migration_item_skipped', workspace_id: workspaceId, table: key },
              'skipped an unreadable inventory item',
            )
            continue
          }
          await database
            .insert(table)
            .values({ ...row, workspaceId, id, position: ids.size, createdAt: now, updatedAt: now } as Table['$inferInsert'])
            .run()
          ids.add(id)
        }
        kept[key].set(workspaceId, ids)
      }
      await copy(printers, PRINTERS, printerRow(now))
      await copy(equipment, EQUIPMENT, equipmentRow(now))
      await copy(consumables, CONSUMABLES, consumableRow(now))
      if (lists[PRINTERS] && kept.printers.get(workspaceId)?.size === 0)
        await database
          .insert(settings)
          .values({ workspaceId, key: PRINTERS_SKIPPED, valueJson: 'true', updatedAt: now })
          .onConflictDoNothing()
          .run()
    }
    await clearMissing(database, log, 'requests', 'printerId', kept.printers)
    await clearMissing(database, log, 'usage_events', 'printerId', kept.printers)
    await clearMissing(database, log, 'usage_events', 'equipmentId', kept.equipment)
    await clearMissing(database, log, 'usage_events', 'consumableId', kept.consumables)
    await database
      .delete(settings)
      .where(inArray(settings.key, [PRINTERS, EQUIPMENT, CONSUMABLES]))
      .run()
  },
}

async function clearMissing(
  database: MigrationTransaction,
  log: MigrationLog,
  name: 'requests' | 'usage_events',
  key: 'printerId' | 'equipmentId' | 'consumableId',
  kept: Map<string, Set<string>>,
) {
  const table = name === 'requests' ? requests : usageEvents
  const column = (table as typeof usageEvents)[key]
  const referenced = await database
    .selectDistinct({ workspaceId: table.workspaceId, id: column })
    .from(table)
    .where(isNotNull(column))
    .all()
  const missing = new Map<string, string[]>()
  for (const { workspaceId, id } of referenced) {
    if (id && !kept.get(workspaceId)?.has(id)) missing.set(workspaceId, [...(missing.get(workspaceId) ?? []), id])
  }
  for (const [workspaceId, ids] of missing) {
    const { changes } = await database
      .update(table)
      .set({ [key]: null })
      .where(and(eq(table.workspaceId, workspaceId), inArray(column, ids)))
      .run()
    log.warn(
      { event: 'data_migration_reference_cleared', workspace_id: workspaceId, table: name, column: column.name, count: changes },
      'cleared references to inventory items that no longer exist',
    )
  }
}

function printerRow(now: number) {
  return (item: Stored): Row<typeof printers> => {
    const printer = normalizePrinterProfile(item as PrinterProfile)
    return {
      name: printer.name,
      printType: printer.printType,
      presetId: printer.presetId ?? null,
      widthMm: printer.widthMm ?? null,
      depthMm: printer.depthMm ?? null,
      heightMm: printer.heightMm ?? null,
      purchasePrice: printer.purchasePrice ?? null,
      lifespanHours: printer.lifespanHours ?? null,
      powerWatts: printer.powerWatts ?? null,
      addOnPresetIdsJson: JSON.stringify(printer.addOnPresetIds ?? []),
      archivedAt: printer.archived ? now : null,
    }
  }
}

function equipmentRow(now: number) {
  return (item: Stored): Row<typeof equipment> | undefined => {
    if (!EQUIPMENT_KINDS.has(item.kind as string) || !EQUIPMENT_STAGES.has(item.stage as string)) return undefined
    return {
      name: item.name as string,
      presetId: optionalText(item.presetId),
      kind: item.kind as string,
      stage: item.stage as string,
      printType: PRINT_TYPES.has(item.printType as string) ? (item.printType as string) : null,
      powerWatts: optionalNumber(item.powerWatts) ?? 0,
      minutesPerUse: optionalNumber(item.minutesPerUse) ?? 0,
      suppliesJson: JSON.stringify(Array.isArray(item.supplies) ? item.supplies : []),
      purchasePrice: optionalNumber(item.purchasePrice),
      lifespanHours: optionalNumber(item.lifespanHours),
      archivedAt: item.archived ? now : null,
    }
  }
}

function consumableRow(now: number) {
  return (item: Stored): Row<typeof consumables> | undefined => {
    const shared = {
      kind: item.kind as string,
      name: item.name as string,
      minimumStock: optionalNumber(item.minimumStock),
      packSize: optionalNumber(item.packSize),
      archivedAt: item.archived ? now : null,
    }
    if (item.kind === 'resin')
      return {
        ...shared,
        presetId: optionalText(item.resinPresetId),
        price: optionalNumber(item.pricePerLitre) ?? 0,
        densityGramsPerMl: optionalNumber(item.densityGramsPerMl) ?? 1.1,
      }
    if (item.kind === 'filament')
      return {
        ...shared,
        presetId: optionalText(item.filamentPresetId),
        price: optionalNumber(item.pricePerKg) ?? 0,
        colourJson: item.colour ? JSON.stringify(item.colour) : null,
      }
    if (item.kind === 'part' && PRINT_TYPES.has(item.printType as string))
      return {
        ...shared,
        presetId: optionalText(item.partPresetId),
        price: optionalNumber(item.price) ?? 0,
        printType: item.printType as string,
        lifespan: optionalNumber(item.lifespan) ?? 1,
        lifespanUnit: item.lifespanUnit === 'hours' ? 'hours' : 'plates',
        printerPresetId: optionalText(item.printerPresetId),
        printerId: optionalText(item.printerId),
      }
    if (item.kind === 'supply' && SUPPLY_UNITS.has(item.unit as string))
      return { ...shared, price: optionalNumber(item.price) ?? 0, unit: item.unit as string }
    return undefined
  }
}

function optionalText(value: unknown) {
  return typeof value === 'string' && value ? value : null
}

function optionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
