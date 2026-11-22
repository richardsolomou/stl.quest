import type { Consumable } from '../../../core/consumables'
import type { EquipmentItem } from '../../../core/equipment'
import type { Locale, Messages } from '../../../core/i18n'
import type { PrinterProfile } from '../../../core/types'
import type { UsageEvent, UsageUnit } from '../../../core/usage'
import { formatNumber } from '../priceCalculator/format'

export function formatUsageAmount(amount: number, unit: UsageUnit, t: Messages['spend'], locale: Locale) {
  if (unit === 'minute') {
    const rounded = Math.round(amount)
    const hours = Math.floor(rounded / 60)
    return hours
      ? t.units.hours(formatNumber(hours, locale), formatNumber(rounded % 60, locale))
      : t.units.minutes(formatNumber(rounded, locale))
  }
  const value = formatNumber(amount, locale, amount < 10 ? 2 : amount < 100 ? 1 : 0)
  return unit === 'plate' ? t.units.plate(value, amount) : t.units[unit](value)
}

export type UsageLibrary = { consumables: Consumable[]; equipment: EquipmentItem[]; printers: PrinterProfile[] }

/** The name of what an event used, marked when it was deleted, or undefined when it has left the library unnamed. */
export function usedItemName(
  event: Pick<UsageEvent, 'consumableId' | 'equipmentId' | 'printerId' | 'deletedItemName'>,
  library: UsageLibrary,
  t: Messages['spend'],
) {
  const { consumableId, equipmentId, printerId, deletedItemName } = event
  if (deletedItemName !== undefined) return t.deletedItem(deletedItemName)
  if (consumableId) return library.consumables.find(({ id }) => id === consumableId)?.name
  if (equipmentId) return library.equipment.find(({ id }) => id === equipmentId)?.name
  return library.printers.find(({ id }) => id === printerId)?.name
}
