import { consumablesOfKind, type Consumable } from './consumables'

/**
 * Spoolman (github.com/Donkie/Spoolman) holds a workspace's filament stock spool by spool. A bridge next to it, or any
 * tool that can send HTTP, pushes its spools to STL Quest with a write-only token; STL Quest never reaches into the
 * user's network. A library filament linked to Spoolman filaments takes its stock from their spools instead of the
 * usage log.
 */

/** The most spools one workspace keeps, which bounds both one request and the spools single events can add. */
export const MAX_SPOOLMAN_SPOOLS = 5_000
/** Request bodies above this are refused before they are parsed. */
export const MAX_SPOOLMAN_BODY_BYTES = 2 * 1024 * 1024
export const SPOOLMAN_TOKEN_PREFIX = 'stlq_spoolman_'
export const SPOOLMAN_BRIDGE_IMAGE = 'ghcr.io/richardsolomou/stl.quest-spoolman-bridge:latest'

/** A Compose service for the bridge, with the token once it has just been created and a placeholder after. */
export function spoolmanBridgeCompose(appUrl: string, token?: string) {
  return [
    'services:',
    '  stlquest-spoolman-bridge:',
    `    image: ${SPOOLMAN_BRIDGE_IMAGE}`,
    '    restart: unless-stopped',
    '    environment:',
    '      SPOOLMAN_URL: http://spoolman:7912',
    `      STLQUEST_URL: ${appUrl}`,
    `      STLQUEST_TOKEN: ${token ?? `${SPOOLMAN_TOKEN_PREFIX}…`}`,
    '',
  ].join('\n')
}

export type SpoolmanSpool = {
  id: number
  filamentId: number
  filamentName?: string
  vendor?: string
  material?: string
  /** `#RRGGBB`; absent for a multicolour filament. */
  colourHex?: string
  /** The SpoolmanDB ID a filament imported from it keeps, such as `bambulab_pla_black_1000_175_n`. */
  externalId?: string
  /** Absent when Spoolman knows neither the spool's nor its filament's weight. */
  remainingGrams?: number
  archived: boolean
  updatedAt: number
}

/** What Spoolman sent, as one change: every spool it has, or one spool added, updated, or deleted. */
export type SpoolmanChange =
  | { replace: Omit<SpoolmanSpool, 'updatedAt'>[] }
  | { upsert: Omit<SpoolmanSpool, 'updatedAt'> }
  | { remove: number }

export type SpoolmanFilament = {
  id: number
  name?: string
  vendor?: string
  material?: string
  colourHex?: string
  externalId?: string
  /** Spools not archived. */
  spools: number
  /** Grams left across the spools not archived. */
  remainingGrams: number
}

/** A Spoolman filament someone linked by hand; a null consumable keeps it linked to none. */
export type SpoolmanLink = { filamentId: number; consumableId: string | null }

/**
 * How a Spoolman filament found its library filament: chosen by hand, by its SpoolmanDB ID, by brand, material, and
 * colour, or by its name among the filaments of its brand and material.
 */
export type SpoolmanMatch = { consumableId: string; by: 'manual' | 'catalogue' | 'colour' | 'name' }

/**
 * The filament catalogue as matching reads it: each SpoolmanDB ID stem's catalogue product and colour name, and each
 * product's brand, material, and name.
 */
export type SpoolmanCatalogue = {
  colours: Record<string, readonly [presetId: string, colour: string]>
  presets: Record<string, readonly [brand: string, material: string, product: string]>
}

/**
 * The part of a SpoolmanDB ID that names the product and colour. SpoolmanDB builds IDs as
 * `<manufacturer>_<material>_<name>_<weight>_<diameter>_<spool type>`, and the name is the product's template filled
 * with the colour ("Matte Charcoal"), so the stem tells product lines apart only through that name.
 */
export function externalIdStem(externalId: string) {
  return externalId.replace(/_\d+_\d+_[npcm]$/, '')
}

/** SpoolmanDB's form of a manufacturer, material, and filled-in name, as `externalIdStem` leaves it. */
export function spoolmanDbStem(manufacturer: string, material: string, name: string) {
  return `${manufacturer.toLowerCase()}_${material.toLowerCase()}_${name.replace(/[^ -~]/g, '').toLowerCase()}`.replaceAll(' ', '')
}

/** Spools grouped by filament, each described by its most recently sent spool, in vendor and name order. */
export function spoolmanFilaments(spools: SpoolmanSpool[]): SpoolmanFilament[] {
  const latest = new Map<number, SpoolmanSpool>()
  const totals = new Map<number, { spools: number; remainingGrams: number }>()
  for (const spool of spools) {
    const current = latest.get(spool.filamentId)
    if (!current || spool.updatedAt > current.updatedAt) latest.set(spool.filamentId, spool)
    const total = totals.get(spool.filamentId) ?? { spools: 0, remainingGrams: 0 }
    if (!spool.archived) {
      total.spools += 1
      total.remainingGrams += Math.max(0, spool.remainingGrams ?? 0)
    }
    totals.set(spool.filamentId, total)
  }
  return [...latest.values()]
    .map(({ filamentId, filamentName, vendor, material, colourHex, externalId }) => ({
      id: filamentId,
      ...(filamentName && { name: filamentName }),
      ...(vendor && { vendor }),
      ...(material && { material }),
      ...(colourHex && { colourHex }),
      ...(externalId && { externalId }),
      ...totals.get(filamentId)!,
    }))
    .sort(
      (left, right) =>
        (left.vendor ?? '').localeCompare(right.vendor ?? '') || (left.name ?? '').localeCompare(right.name ?? '') || left.id - right.id,
    )
}

/**
 * The library filament each Spoolman filament is: the one linked by hand, else the catalogue colour its SpoolmanDB ID
 * names, else the only catalogued filament of its brand, material, and colour, else the only one of those (or, without
 * a colour hex, of its brand and material) its name fits. A match that fits more than one library filament is left for
 * someone to link.
 */
export function matchSpoolmanFilaments(
  filaments: SpoolmanFilament[],
  consumables: Consumable[],
  links: SpoolmanLink[],
  catalogue: SpoolmanCatalogue,
): Map<number, SpoolmanMatch> {
  const library = consumablesOfKind(consumables, 'filament')
  const manual = new Map(links.map((link) => [link.filamentId, link.consumableId]))
  const matches = new Map<number, SpoolmanMatch>()
  const only = (candidates: typeof library) => (candidates.length === 1 ? candidates[0].id : undefined)
  for (const filament of filaments) {
    if (manual.has(filament.id)) {
      const consumableId = manual.get(filament.id)
      if (consumableId && library.some(({ id }) => id === consumableId)) matches.set(filament.id, { consumableId, by: 'manual' })
      continue
    }
    const named = filament.externalId ? catalogue.colours[externalIdStem(filament.externalId)] : undefined
    const byCatalogue =
      named && only(library.filter(({ filamentPresetId, colour }) => filamentPresetId === named[0] && sameText(colour?.name, named[1])))
    if (byCatalogue) {
      matches.set(filament.id, { consumableId: byCatalogue, by: 'catalogue' })
      continue
    }
    if (!filament.vendor || !filament.material) continue
    const candidates = library.filter(({ filamentPresetId, colour }) => {
      const preset = filamentPresetId ? catalogue.presets[filamentPresetId] : undefined
      return (
        preset &&
        sameText(preset[0], filament.vendor) &&
        sameText(preset[1], filament.material) &&
        (!filament.colourHex || colour?.hex.toUpperCase() === filament.colourHex.toUpperCase())
      )
    })
    const byColour = filament.colourHex && only(candidates)
    if (byColour) {
      matches.set(filament.id, { consumableId: byColour, by: 'colour' })
      continue
    }
    const products = Object.entries(catalogue.presets).filter(
      ([, [brand, material]]) => sameText(brand, filament.vendor) && sameText(material, filament.material),
    )
    const presetIds = new Set(products.map(([id]) => id))
    const colourNames = new Set(
      Object.values(catalogue.colours)
        .filter(([presetId]) => presetIds.has(presetId))
        .map(([, colour]) => words(colour).join(' ')),
    )
    const byName =
      filament.name &&
      only(
        candidates.filter(({ filamentPresetId, colour }) =>
          namesFilament(filament.name!, catalogue.presets[filamentPresetId!], colour?.name, {
            bareColour: !!filament.colourHex && products.length === 1,
            colourNames,
          }),
        ),
      )
    if (byName) matches.set(filament.id, { consumableId: byName, by: 'name' })
  }
  return matches
}

/** A name's words in order, lowercased, with "+" kept as part of a word so "PLA+" stays apart from "PLA". */
const words = (value: string) => value.toLowerCase().match(/[\p{L}\p{N}+]+/gu) ?? []

/**
 * Whether a name typed into Spoolman, such as "PLA Basic Black" or "Matte Charcoal", is this catalogue product in this
 * colour: after an optional leading brand and material, it is the product and colour in order, where the product may
 * leave out its material words. A rest that is itself one of the brand's colours for the material ("Wood Tone") reads
 * only as that colour, and a bare colour fits only when `bareColour` allows it.
 */
function namesFilament(
  name: string,
  [brand, material, product]: readonly [string, string, string],
  colour: string | undefined,
  { bareColour, colourNames }: { bareColour: boolean; colourNames: Set<string> },
) {
  const colourName = words(colour ?? '').join(' ')
  if (!colourName) return false
  const materialWords = new Set(words(material))
  const productNames = [words(product), words(product).filter((word) => !materialWords.has(word))].filter(
    (productName) => productName.length > 0,
  )
  const given = words(name).join(' ')
  return ['', brand, material, `${brand} ${material}`]
    .map((prefix) => words(prefix).join(' '))
    .filter((prefix) => !prefix || given.startsWith(`${prefix} `))
    .map((prefix) => (prefix ? given.slice(prefix.length + 1) : given))
    .some(
      (rest) =>
        (bareColour && rest === colourName) ||
        (!colourNames.has(rest) && productNames.some((productName) => rest === `${productName.join(' ')} ${colourName}`)),
    )
}

/** Stock per library filament from the Spoolman filaments matched to it. */
export function spoolmanStock(filaments: SpoolmanFilament[], matches: Map<number, SpoolmanMatch>) {
  const stock = new Map<string, { onHand: number; spools: number }>()
  for (const filament of filaments) {
    const match = matches.get(filament.id)
    if (!match) continue
    const total = stock.get(match.consumableId) ?? { onHand: 0, spools: 0 }
    stock.set(match.consumableId, { onHand: total.onHand + filament.remainingGrams, spools: total.spools + filament.spools })
  }
  return stock
}

/** Whether two names read the same, ignoring case, spaces, and punctuation other than "+", so "PLA+" is not "PLA". */
export function sameText(left: string | undefined, right: string | undefined) {
  const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}+]/gu, '')
  return left !== undefined && right !== undefined && normalize(left) === normalize(right)
}
