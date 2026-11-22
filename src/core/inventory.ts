import { MAX_CONSUMABLES, type Consumable } from './consumables'
import { MAX_EQUIPMENT, type EquipmentItem } from './equipment'
import { MAX_PRINTERS } from './printers'
import type { PrinterProfile } from './types'

/**
 * What a workspace owns, each kind in the order it was added. Items are archived first, so prints and usage that name
 * one keep resolving it while pickers and pricing leave it out; an archived item can then be deleted for good.
 */
export type InventoryItems = { printers: PrinterProfile; equipment: EquipmentItem; consumables: Consumable }
export type InventoryKind = keyof InventoryItems
export type InventoryItem = InventoryItems[InventoryKind]

export const INVENTORY_KINDS = ['printers', 'equipment', 'consumables'] as const satisfies InventoryKind[]

/** How many items of each kind a workspace keeps in use at once; archived ones do not count. */
export const INVENTORY_LIMITS: Record<InventoryKind, number> = {
  printers: MAX_PRINTERS,
  equipment: MAX_EQUIPMENT,
  consumables: MAX_CONSUMABLES,
}

export function activeItems<Item extends { archived?: boolean }>(items: Item[]) {
  return items.filter((item) => !item.archived)
}
