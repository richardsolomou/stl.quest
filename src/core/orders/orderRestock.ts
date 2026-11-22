import { consumablesOfKind, consumableUnit, type Consumable, type FilamentColour, type FilamentConsumable } from '../consumables'
import { filamentConsumableName, type FilamentPreset } from '../filamentPresets'
import type { PriceCalculatorCurrency } from '../priceCalculator'
import { MAX_RESTOCK_SPOOLS } from '../spoolmanRestocks'
import { storeCurrency, type Store } from '../stores'
import { packSize } from '../stock'
import type { OrderLine, OrderVendor, ParsedOrder } from './orderEmail'
import { normalizedWords } from './orderText'

/** The catalogue brand each shop sells. */
export const ORDER_VENDOR_BRANDS: Record<OrderVendor, string> = { 'bambu-lab': 'Bambu Lab' }

/**
 * What an order line is in the workspace: a library consumable to restock, one Spoolman manages (its spool is added
 * there instead), a catalogue colour the library lacks, or nothing known.
 */
export type OrderLineMatch =
  | { kind: 'library'; consumableId: string }
  | { kind: 'spoolman'; consumableId: string }
  | { kind: 'catalogue'; presetId: string; colour: FilamentColour }
  | { kind: 'unmatched' }

const NOISE = new Set(['bambu', 'lab', 'bambulab', 'filament', 'refill', 'spool', 'with', 'kg', 'g', 'mm'])

/** A product title's words, without the brand, the packaging, or sizes, in a fixed order so word order never matters. */
function productWords(text: string) {
  return normalizedWords(text)
    .filter((word) => !NOISE.has(word) && !/^\d+(?:kg|g|mm)?$/.test(word))
    .toSorted()
    .join(' ')
}

const sameWords = (left: string | undefined, right: string | undefined) =>
  left !== undefined && right !== undefined && normalizedWords(left).join(' ') === normalizedWords(right).join(' ')

/**
 * The library filament, or else the catalogue colour, an order line names. The colour's code names both, whatever
 * language the shop printed its name in. Without a known code, a catalogue product matches when its words are the
 * title's in any order ("PETG HF" is HF PETG), and a colour by any of its names. Without a catalogue product,
 * the only library filament whose name holds every word of the title and colour matches.
 */
export function matchOrderLine(
  vendor: OrderVendor,
  line: OrderLine,
  consumables: Consumable[],
  catalogue: readonly FilamentPreset[],
  managedBySpoolman: ReadonlySet<string>,
): OrderLineMatch {
  const library = consumablesOfKind(consumables, 'filament')
  const found = (consumableId: string): OrderLineMatch =>
    managedBySpoolman.has(consumableId) ? { kind: 'spoolman', consumableId } : { kind: 'library', consumableId }
  const brand = ORDER_VENDOR_BRANDS[vendor]
  const code = line.colour?.code
  const coded = code
    ? catalogue.flatMap((candidate) => {
        const colour = candidate.brand === brand ? candidate.colors?.find((option) => option.code === code) : undefined
        return colour ? [{ preset: candidate, colour }] : []
      })[0]
    : undefined
  const words = productWords(line.product)
  const preset = coded?.preset ?? catalogue.find((candidate) => candidate.brand === brand && productWords(candidate.name) === words)
  const catalogued =
    coded?.colour ?? preset?.colors?.find(({ names }) => Object.values(names).some((name) => sameWords(name, line.colour?.name)))
  const colourName = catalogued?.names.en ?? line.colour?.name
  const stocked =
    preset && library.find((filament) => filament.filamentPresetId === preset.id && sameWords(filament.colour?.name, colourName))
  if (stocked) return found(stocked.id)
  if (preset && catalogued) return { kind: 'catalogue', presetId: preset.id, colour: { name: catalogued.names.en, hex: catalogued.hex } }
  const wanted = normalizedWords(`${line.product} ${line.colour?.name ?? ''}`).filter((word) => !NOISE.has(word))
  const named = library.filter((filament) => {
    const name = new Set(normalizedWords(filament.name))
    return wanted.every((word) => name.has(word))
  })
  return named.length === 1 ? found(named[0].id) : { kind: 'unmatched' }
}

/**
 * What one confirmed line restocks: a library consumable, a catalogue colour added to the library with it, or spools
 * of a filament Spoolman manages, which the Spoolman bridge adds there.
 */
export type OrderRestockChoice =
  | { line: OrderLine; consumableId: string }
  | { line: OrderLine; add: { presetId: string; colour: FilamentColour } }
  | { line: OrderLine; spoolman: string }

/** What confirming an order stores, in the consumables' own units and currencies. */
export type OrderRestockInput = {
  vendor: OrderVendor
  /** Catalogue colours that join the library, priced from the order. */
  added: FilamentConsumable[]
  /** New prices, when the order is in the currency each is priced in and someone chose to take them. */
  prices: { consumableId: string; price: number }[]
  restocks: { consumableId: string; amount: number }[]
  /** Spools to add in Spoolman for filaments it manages, each holding `grams` when the order says. */
  spoolman?: { consumableId: string; spools: number; grams?: number }[]
}

/** What a line holds in a consumable's unit: its stated weight per unit, or else the consumable's pack size, times the quantity. */
export function orderLineAmount(line: OrderLine, consumable: Consumable) {
  const each = consumable.kind === 'filament' && line.grams ? line.grams : packSize(consumable)
  return each === undefined ? undefined : each * line.quantity
}

/** What a line cost per unit the consumable is priced in (a kilogram of filament, a litre of resin, or an item). */
export function orderLinePrice(line: OrderLine, consumable: Consumable) {
  const amount = orderLineAmount(line, consumable)
  if (line.linePrice === undefined || !amount) return undefined
  const priced = consumableUnit(consumable) === 'item' ? amount : amount / 1_000
  return Math.round((line.linePrice / priced) * 100) / 100
}

/**
 * The restocks, additions, and prices confirming an order stores. Lines for the same consumable add up, and its new
 * price is what they cost together. Prices come from the order only in the currency a consumable is priced in, its
 * store's or else the workspace's; a catalogue colour needs a workspace-currency price to join the library, so without
 * it the line is left out.
 */
export function orderRestock(
  order: Pick<ParsedOrder, 'vendor' | 'currency'>,
  choices: OrderRestockChoice[],
  context: {
    consumables: Consumable[]
    stores: Store[]
    catalogue: readonly FilamentPreset[]
    currency: PriceCalculatorCurrency
    updatePrices: boolean
    newId: () => string
  },
): OrderRestockInput {
  const priced = (consumable: Consumable) =>
    order.currency ===
    storeCurrency(
      context.stores.find(({ id }) => id === consumable.storeId),
      context.currency,
    )
  const added = new Map<string, FilamentConsumable>()
  const totals = new Map<string, { consumable: Consumable; amount: number; cost: number; costed: number }>()
  const spoolman: NonNullable<OrderRestockInput['spoolman']> = []
  for (const choice of choices) {
    if ('spoolman' in choice) {
      spoolman.push({
        consumableId: choice.spoolman,
        spools: Math.min(choice.line.quantity, MAX_RESTOCK_SPOOLS),
        ...(choice.line.grams && { grams: choice.line.grams }),
      })
      continue
    }
    const consumable = 'add' in choice ? addition(choice.add) : context.consumables.find(({ id }) => id === choice.consumableId)
    if (!consumable) continue
    const amount = orderLineAmount(choice.line, consumable)
    if (!amount) continue
    const total = totals.get(consumable.id) ?? { consumable, amount: 0, cost: 0, costed: 0 }
    const price = priced(consumable) ? choice.line.linePrice : undefined
    totals.set(consumable.id, {
      consumable,
      amount: total.amount + amount,
      cost: total.cost + (price ?? 0),
      costed: total.costed + (price === undefined ? 0 : amount),
    })
  }
  const unitPrice = ({ consumable, cost, costed }: { consumable: Consumable; cost: number; costed: number }) =>
    costed ? Math.round((cost / (consumableUnit(consumable) === 'item' ? costed : costed / 1_000)) * 100) / 100 : undefined
  const entries = [...totals.values()].filter((total) => !added.has(total.consumable.id) || unitPrice(total))
  return {
    vendor: order.vendor,
    added: entries.flatMap((total) => {
      const item = added.get(total.consumable.id)
      return item ? [{ ...item, pricePerKg: unitPrice(total)! }] : []
    }),
    prices: context.updatePrices
      ? entries.flatMap((total) => {
          const price = unitPrice(total)
          return !added.has(total.consumable.id) && price !== undefined ? [{ consumableId: total.consumable.id, price }] : []
        })
      : [],
    restocks: entries.map(({ consumable, amount }) => ({ consumableId: consumable.id, amount })),
    ...(spoolman.length && { spoolman }),
  }

  function addition({ presetId, colour }: { presetId: string; colour: FilamentColour }) {
    const known = [...added.values()].find((item) => item.filamentPresetId === presetId && item.colour?.name === colour.name)
    if (known) return known
    const preset = context.catalogue.find(({ id }) => id === presetId)
    if (!preset) return undefined
    const item: FilamentConsumable = {
      id: context.newId(),
      kind: 'filament',
      name: filamentConsumableName(preset, colour),
      filamentPresetId: preset.id,
      colour,
      pricePerKg: Number.NaN,
    }
    added.set(item.id, item)
    return item
  }
}
