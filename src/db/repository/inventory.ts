import type { Consumable } from '../../core/consumables'
import type { EquipmentItem } from '../../core/equipment'
import type { InventoryItems, InventoryKind } from '../../core/inventory'
import { normalizePrinterProfile } from '../../core/printers'
import { consumables, equipment, printers } from '../schema'

export const inventoryTables = { printers, equipment, consumables }

type Tables = typeof inventoryTables
type Owned = 'workspaceId' | 'id' | 'position' | 'archivedAt' | 'createdAt' | 'updatedAt'
/** The columns an item's own fields fill; the repository adds where it sits, who owns it, and when it changed. */
export type InventoryColumns<Kind extends InventoryKind> = Omit<Tables[Kind]['$inferInsert'], Owned>
type Row<Kind extends InventoryKind> = Tables[Kind]['$inferSelect']

const defined = <Value>(value: Value | null) => value ?? undefined

export function inventoryItem<Kind extends InventoryKind>(kind: Kind, row: Row<Kind>): InventoryItems[Kind] {
  const archived = row.archivedAt !== null ? { archived: true } : {}
  if (kind === 'printers') {
    const printer = row as Row<'printers'>
    return normalizePrinterProfile({
      id: printer.id,
      name: printer.name,
      printType: printer.printType,
      presetId: defined(printer.presetId),
      widthMm: defined(printer.widthMm),
      depthMm: defined(printer.depthMm),
      heightMm: defined(printer.heightMm),
      purchasePrice: defined(printer.purchasePrice),
      lifespanHours: defined(printer.lifespanHours),
      purchasedOn: defined(printer.purchasedOn),
      powerWatts: defined(printer.powerWatts),
      addOnPresetIds: JSON.parse(printer.addOnPresetIdsJson) as string[],
      ...archived,
    }) as InventoryItems[Kind]
  }
  if (kind === 'equipment') {
    const item = row as Row<'equipment'>
    return {
      id: item.id,
      name: item.name,
      ...(item.presetId !== null && { presetId: item.presetId }),
      kind: item.kind,
      stage: item.stage,
      ...(item.printType !== null && { printType: item.printType }),
      powerWatts: item.powerWatts,
      minutesPerUse: item.minutesPerUse,
      supplies: JSON.parse(item.suppliesJson) as EquipmentItem['supplies'],
      ...(item.purchasePrice !== null && { purchasePrice: item.purchasePrice }),
      ...(item.lifespanHours !== null && { lifespanHours: item.lifespanHours }),
      ...(item.purchasedOn !== null && { purchasedOn: item.purchasedOn }),
      ...archived,
    } satisfies EquipmentItem as InventoryItems[Kind]
  }
  return consumable(row as Row<'consumables'>, archived) as InventoryItems[Kind]
}

function consumable(row: Row<'consumables'>, archived: { archived?: boolean }): Consumable {
  const shared = {
    id: row.id,
    name: row.name,
    ...(row.minimumStock !== null && { minimumStock: row.minimumStock }),
    ...(row.packSize !== null && { packSize: row.packSize }),
    ...archived,
  }
  const preset = (field: string) => (row.presetId !== null ? { [field]: row.presetId } : {})
  if (row.kind === 'resin')
    return { ...shared, kind: 'resin', ...preset('resinPresetId'), pricePerLitre: row.price, densityGramsPerMl: row.densityGramsPerMl ?? 0 }
  if (row.kind === 'filament')
    return {
      ...shared,
      kind: 'filament',
      ...preset('filamentPresetId'),
      ...(row.colourJson !== null && { colour: JSON.parse(row.colourJson) as { name: string; hex: string } }),
      pricePerKg: row.price,
    }
  if (row.kind === 'part')
    return {
      ...shared,
      kind: 'part',
      printType: row.printType ?? 'resin',
      price: row.price,
      lifespan: row.lifespan ?? 0,
      lifespanUnit: row.lifespanUnit ?? 'plates',
      ...(row.printerPresetId !== null && { printerPresetId: row.printerPresetId }),
      ...(row.printerId !== null && { printerId: row.printerId }),
      ...preset('partPresetId'),
    }
  return { ...shared, kind: 'supply', unit: row.unit ?? 'item', price: row.price, ...preset('supplyPresetId') }
}

export function inventoryColumns<Kind extends InventoryKind>(kind: Kind, item: InventoryItems[Kind]): InventoryColumns<Kind> {
  if (kind === 'printers') {
    const printer = normalizePrinterProfile(item)
    return {
      name: printer.name,
      printType: printer.printType,
      presetId: printer.presetId ?? null,
      widthMm: printer.widthMm ?? null,
      depthMm: printer.depthMm ?? null,
      heightMm: printer.heightMm ?? null,
      purchasePrice: printer.purchasePrice ?? null,
      lifespanHours: printer.lifespanHours ?? null,
      purchasedOn: printer.purchasedOn ?? null,
      powerWatts: printer.powerWatts ?? null,
      addOnPresetIdsJson: JSON.stringify(printer.addOnPresetIds ?? []),
    } satisfies InventoryColumns<'printers'> as unknown as InventoryColumns<Kind>
  }
  if (kind === 'equipment') {
    const equipmentItem = item as EquipmentItem
    return {
      name: equipmentItem.name,
      presetId: equipmentItem.presetId ?? null,
      kind: equipmentItem.kind,
      stage: equipmentItem.stage,
      printType: equipmentItem.printType ?? null,
      powerWatts: equipmentItem.powerWatts,
      minutesPerUse: equipmentItem.minutesPerUse,
      suppliesJson: JSON.stringify(equipmentItem.supplies),
      purchasePrice: equipmentItem.purchasePrice ?? null,
      lifespanHours: equipmentItem.lifespanHours ?? null,
      purchasedOn: equipmentItem.purchasedOn ?? null,
    } satisfies InventoryColumns<'equipment'> as unknown as InventoryColumns<Kind>
  }
  const library = item as Consumable
  const unset = {
    presetId: null,
    densityGramsPerMl: null,
    colourJson: null,
    printType: null,
    lifespan: null,
    lifespanUnit: null,
    printerPresetId: null,
    printerId: null,
    unit: null,
  }
  const shared = {
    ...unset,
    kind: library.kind,
    name: library.name,
    minimumStock: library.minimumStock ?? null,
    packSize: library.packSize ?? null,
  }
  const columns: InventoryColumns<'consumables'> =
    library.kind === 'resin'
      ? { ...shared, presetId: library.resinPresetId ?? null, price: library.pricePerLitre, densityGramsPerMl: library.densityGramsPerMl }
      : library.kind === 'filament'
        ? {
            ...shared,
            presetId: library.filamentPresetId ?? null,
            price: library.pricePerKg,
            colourJson: library.colour ? JSON.stringify(library.colour) : null,
          }
        : library.kind === 'part'
          ? {
              ...shared,
              presetId: library.partPresetId ?? null,
              price: library.price,
              printType: library.printType,
              lifespan: library.lifespan,
              lifespanUnit: library.lifespanUnit,
              printerPresetId: library.printerPresetId ?? null,
              printerId: library.printerId ?? null,
            }
          : { ...shared, presetId: library.supplyPresetId ?? null, price: library.price, unit: library.unit }
  return columns as InventoryColumns<Kind>
}
