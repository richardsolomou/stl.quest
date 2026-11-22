import type { Consumable } from './consumables'
import type { EquipmentItem } from './equipment'
import type { InventoryItems, InventoryKind } from './inventory'
import type { DeletedItemKind, UsageEvent } from './usage'

/**
 * What names an item, counted so deleting it says what loses the link: prints and plates lose their printer, usage
 * and stock movements keep their cost under the item's name (see `keepsDeletedName`), equipment stops using a deleted
 * supply, and wear parts bound to a deleted custom printer stay in the library, grouped under a printer that is gone.
 */
export type InventoryReferences = {
  requests: number
  plates: number
  /** Events recorded while printing or finishing. */
  usage: number
  /** Restocks, corrections, waste, and part replacements. */
  stock: number
  /** Equipment that uses the consumable as a supply. */
  supplies: number
  /** Wear parts bound to the custom printer. */
  parts: number
}

export const NO_REFERENCES: InventoryReferences = { requests: 0, plates: 0, usage: 0, stock: 0, supplies: 0, parts: 0 }

/** Only an archived item can be deleted, so deleting is always a second step after archiving, which can be undone. */
export function canDeleteInventoryItem(item: { archived?: boolean }) {
  return item.archived === true
}

export function referenceCount(references: InventoryReferences) {
  return Object.values(references).reduce((total, count) => total + count, 0)
}

export function deletedItemKind<Kind extends InventoryKind>(kind: Kind, item: InventoryItems[Kind]): DeletedItemKind {
  if (kind === 'printers') return 'printer'
  if (kind === 'equipment') return 'equipment'
  return (item as Consumable).kind
}

/**
 * Whether an event naming a deleted item keeps that item's name: only when the item is what the event used, which is
 * its consumable, else its equipment, else its printer. Resin printed on a deleted printer stays the resin's, and an
 * event that already kept the name of something deleted before keeps that.
 */
export function keepsDeletedName(event: Pick<UsageEvent, 'consumableId' | 'equipmentId' | 'deletedItemName'>, kind: InventoryKind) {
  if (event.deletedItemName !== undefined) return false
  if (kind === 'consumables') return true
  if (event.consumableId) return false
  return kind === 'equipment' || !event.equipmentId
}

/** Equipment no longer using a deleted consumable, which `missingSupplies` would otherwise flag for good. */
export function withoutSupply(item: EquipmentItem, consumableId: string): EquipmentItem {
  return { ...item, supplies: item.supplies.filter((supply) => supply.consumableId !== consumableId) }
}
