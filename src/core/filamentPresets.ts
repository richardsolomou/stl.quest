import { consumablesOfKind, type Consumable, type FilamentColour, type FilamentConsumable } from './consumables'
import type { PriceCalculatorCurrency } from './priceCalculator'
import { consumableCurrency, type Store } from './stores'

export type FilamentPreset = {
  id: string
  brand: string
  name: string
  type?: string
  densityGramsPerCm3?: number
  /** Each colour, with the manufacturer's code for it when known, such as Bambu Lab's 10103 for PLA Basic Gray. */
  colors?: { hex: string; names: { en: string; de?: string; fr?: string }; code?: string }[]
  source: { id: string; url: string }
}

/** A catalogued filament's stored name: the product, then the colour when one is chosen. */
export function filamentConsumableName(preset: Pick<FilamentPreset, 'brand' | 'name'>, colour?: FilamentColour) {
  const product = `${preset.brand} ${preset.name}`
  return colour ? `${product} · ${colour.name}` : product
}

/** A library filament from the catalogue, unpriced (NaN) since the catalogue knows no prices, with its colour still to pick. */
export function filamentFromPreset(id: string, preset: FilamentPreset): FilamentConsumable {
  return { id, kind: 'filament', name: filamentConsumableName(preset), filamentPresetId: preset.id, pricePerKg: Number.NaN }
}

/**
 * One filament per colour of a catalogue product, sharing the draft's price and stock fields. Each takes a new ID, so the
 * draft itself is never stored and its dialog cannot save over one of them.
 */
export function filamentsInColours(
  draft: FilamentConsumable,
  preset: FilamentPreset,
  colours: FilamentColour[],
  newId: (colour: FilamentColour) => string,
): FilamentConsumable[] {
  return colours.map((colour) => ({
    ...draft,
    id: newId(colour),
    colour,
    name: filamentConsumableName(preset, colour),
  }))
}

/** The other active colours of the catalogue product a filament is; none for a filament of the user's own. */
export function sameFilamentProduct(consumables: Consumable[], filament: FilamentConsumable) {
  if (!filament.filamentPresetId) return []
  return consumablesOfKind(consumables, 'filament').filter(
    (other) => other.id !== filament.id && other.filamentPresetId === filament.filamentPresetId,
  )
}

/** The colours of a catalogue product the library already has in use. */
export function stockedColours(consumables: Consumable[], presetId: string) {
  return consumablesOfKind(consumables, 'filament').flatMap((filament) =>
    filament.filamentPresetId === presetId && filament.colour ? [filament.colour] : [],
  )
}

export function sameFilamentColour(a: FilamentColour, b: FilamentColour) {
  return a.name === b.name && a.hex.toLowerCase() === b.hex.toLowerCase()
}

/** Filaments in a list, with each catalogue product of more than one colour gathered where its first colour sits. */
export type FilamentProductGroup = { presetId?: string; filaments: FilamentConsumable[] }

export function filamentProductGroups(filaments: FilamentConsumable[]): FilamentProductGroup[] {
  const groups: FilamentProductGroup[] = []
  const byPreset = new Map<string, FilamentConsumable[]>()
  for (const filament of filaments) {
    const known = filament.filamentPresetId && byPreset.get(filament.filamentPresetId)
    if (known) {
      known.push(filament)
      continue
    }
    const group = { filaments: [filament] }
    if (filament.filamentPresetId) byPreset.set(filament.filamentPresetId, group.filaments)
    groups.push(group)
  }
  return groups.map((group) =>
    group.filaments.length > 1 ? { presetId: group.filaments[0].filamentPresetId, filaments: group.filaments } : group,
  )
}

/** The other active colours of a filament's catalogue product that are priced in the same currency, so can share its price. */
export function samePricedColours(
  consumables: Consumable[],
  filament: FilamentConsumable,
  stores: Store[],
  workspace: PriceCalculatorCurrency,
) {
  const currency = consumableCurrency(filament, stores, workspace)
  return sameFilamentProduct(consumables, filament).filter((other) => consumableCurrency(other, stores, workspace) === currency)
}

/** The library with a filament's price given to its `samePricedColours`. */
export function withSharedFilamentPrice(consumables: Consumable[], sourceId: string, stores: Store[], workspace: PriceCalculatorCurrency) {
  const source = consumables.find((item): item is FilamentConsumable => item.id === sourceId && item.kind === 'filament')
  if (!source) return consumables
  const siblings = new Set(samePricedColours(consumables, source, stores, workspace).map(({ id }) => id))
  return consumables.map((item) => (item.kind === 'filament' && siblings.has(item.id) ? { ...item, pricePerKg: source.pricePerKg } : item))
}
