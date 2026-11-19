import type { PrintType } from './types'

export const CONSUMABLES_SETTING = 'consumables'
export const MAX_CONSUMABLES = 200

export type ResinConsumable = {
  id: string
  kind: 'resin'
  name: string
  resinPresetId?: string
  pricePerLitre: number
  densityGramsPerMl: number
}

export type FilamentConsumable = { id: string; kind: 'filament'; name: string; pricePerKg: number }

/** A part that wears out, such as a resin tank or build plate, costed across the plates or print hours it lasts. */
export type PartConsumable = {
  id: string
  kind: 'part'
  name: string
  printType: PrintType
  price: number
  lifespan: number
  lifespanUnit: 'plates' | 'hours'
}

export type Consumable = ResinConsumable | FilamentConsumable | PartConsumable

export const CONSUMABLE_KINDS = ['resin', 'filament', 'part'] as const satisfies Consumable['kind'][]

export function consumablesOfKind<Kind extends Consumable['kind']>(consumables: Consumable[], kind: Kind) {
  return consumables.filter((consumable): consumable is Extract<Consumable, { kind: Kind }> => consumable.kind === kind)
}

export function wearPartsFor(consumables: Consumable[], printType: PrintType) {
  return consumablesOfKind(consumables, 'part').filter((part) => part.printType === printType)
}

export function partCostPerPlate(part: PartConsumable) {
  return part.lifespanUnit === 'plates' ? spread(part) : 0
}

export function partCostPerHour(part: PartConsumable) {
  return part.lifespanUnit === 'hours' ? spread(part) : 0
}

function spread(part: PartConsumable) {
  return part.lifespan > 0 && Number.isFinite(part.price) ? Math.max(0, part.price) / part.lifespan : 0
}
