// Seeds a disposable development workspace shaped like a mixed resin and filament print farm: catalogue printers and
// equipment at list prices (sources in seedPowerUserPrices.json), a priced consumables library with stock, several
// requesters, prints in every stage, older finished prints in the archive, and six weeks of recorded usage. Run with
// `just seed-power`, or `just seed-power-reset` to delete the workspace and seed it again.
import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import {
  consumableUnit,
  type Consumable,
  type FilamentConsumable,
  type PartConsumable,
  type ResinConsumable,
  type SupplyConsumable,
} from '../src/core/consumables'
import type { EquipmentItem } from '../src/core/equipment'
import { equipmentFromPreset, getEquipmentPreset } from '../src/core/equipmentPresets'
import electricityCatalog from '../catalogs/electricity/catalog.generated.json'
import filamentCatalog from '../catalogs/filaments/catalog.generated.json'
import partCatalog from '../catalogs/parts/catalog.json'
import resinCatalog from '../catalogs/resins/catalog.generated.json'
import { getElectricityPricePreset } from '../src/core/electricityPresets'
import { filamentConsumableName, type FilamentPreset } from '../src/core/filamentPresets'
import type { PartPreset } from '../src/core/partPresets'
import {
  DEFAULT_PRICE_CALCULATOR_SETTINGS,
  PRICE_CALCULATOR_SETTING,
  TYPICAL_RESIN_DENSITY_GRAMS_PER_ML,
  type PriceCalculatorSettings,
} from '../src/core/priceCalculator'
import { getPrinterPreset } from '../src/core/printerPresets'
import { automaticEstimateFields, automaticPrintEstimate, requestPrintEstimate } from '../src/core/printEstimates'
import { findPreset } from '../src/core/presets'
import type { ResinPreset } from '../src/core/resinPresets'
import { USAGE_TRACKING_SETTING } from '../src/core/usageTracking'
import { partFromPreset, packSize } from '../src/core/stock'
import { STLQuestService } from '../src/core/services'
import type {
  AssetStore,
  BoardConfig,
  ModelDimensions,
  PrintGroupColor,
  PrinterProfile,
  PrintType,
  UploadStagingArea,
} from '../src/core/types'
import { consumed, stepUsageDrafts, type StepUsageInput, type UsageDraft, type UsageEvent } from '../src/core/usage'
import { DrizzleRepository } from '../src/db/repository'
import { requests as requestsTable, user } from '../src/db/schema'
import { generateVisualAssets } from '../src/server/assets/pipeline'
import { createAuth } from '../src/server/auth'
import { previewModelStl, type PreviewShape } from './previewModels'
import { PREVIEW_PASSWORD as PASSWORD } from './seedPreview'
import prices from './seedPowerUserPrices.json'

const NAME = 'Northside Print Works'
const OWNER_EMAIL = 'power@stl.quest'
const AUTO_ARCHIVE_DAYS = 21
const HOUR = 3_600_000
const DAY = 24 * HOUR
const NOW = Date.now()
const reset = process.argv.includes('--reset')
const printsDir = path.resolve(process.env.PRINTS_DIR!)

const repo = await DrizzleRepository.open()
const auth = createAuth(repo.database, 'stlquest-disposable-preview-secret', { baseURL: 'http://preview.local' })

let seed = 7
const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]
const between = (min: number, max: number) => min + Math.floor(random() * (max - min + 1))
const cents = (value: number) => Math.round(value * 100) / 100
const required = <T>(value: T | undefined, what: string) => {
  if (value === undefined) throw new Error(`missing ${what}`)
  return value
}

type ListPrice = { amount?: number; currency?: string; packAmount?: number; packUnit?: string; lifespanHours?: number }
const listed = (group: Record<string, ListPrice>, id: string) => required(group[id], `price for ${id} in seedPowerUserPrices.json`)
/** A list price in euros, converting a US store's dollars at the recorded ECB rate. */
const euros = ({ amount, currency }: ListPrice) =>
  amount === undefined ? undefined : cents(currency === 'USD' ? amount / prices.usdPerEur.rate : amount)

async function account(email: string, name: string) {
  let found = await repo.database.select().from(user).where(eq(user.email, email)).get()
  if (!found) {
    await auth.api.signUpEmail({ body: { email, password: PASSWORD, name } })
    found = await repo.database.select().from(user).where(eq(user.email, email)).get()
  }
  return found!
}

const owner = await account(OWNER_EMAIL, 'Jordan Reyes')
const ownedSeeds = []
for (const workspace of await repo.listWorkspaces()) {
  if (workspace.name !== NAME) continue
  const members = await (await repo.scoped(workspace.id)).listUsers()
  if (members.some((member) => member.id === owner.id && member.workspaceRole === 'owner')) ownedSeeds.push(workspace)
}
if (ownedSeeds.length && !reset) {
  console.log(`${NAME} already seeded; run \`just seed-power-reset\` to delete it and seed it again`)
  await repo.close()
  process.exit(0)
}
// Deleting the workspace record cascades to its requests, tags, settings, usage, and memberships; the accounts stay.
for (const workspace of ownedSeeds) {
  await repo.deleteWorkspaceRecord(workspace.id)
  fs.rmSync(path.join(printsDir, workspace.id), { recursive: true, force: true })
  console.log(`deleted ${NAME} (${workspace.id})`)
}

// Catalogue model, bay label, count, and add-on modules bolted onto each.
const fleet: [string, string, number, string[]?][] = [
  ['resin-formlabs-form-4', 'Form 4', 2],
  ['resin-elegoo-saturn-4-ultra-16k', 'Saturn 4 Ultra', 2],
  ['resin-elegoo-mars-5-ultra', 'Mars 5 Ultra', 2],
  ['resin-phrozen-sonic-mighty-revo', 'Mighty Revo', 1],
  ['resin-anycubic-photon-mono-m7-pro', 'M7 Pro', 1],
  ['resin-heygears-reflex-rs-turbo', 'Reflex RS Turbo', 1, ['accessory-heygears-pulsing-release-module']],
  ['filament-bambu-lab-x1-carbon', 'X1C', 4, ['accessory-bambu-lab-ams']],
  ['filament-bambu-lab-p1s', 'P1S', 4, ['accessory-bambu-lab-ams']],
  ['filament-bambu-lab-h2d', 'H2D', 2],
  ['filament-prusa-core-one', 'CORE One', 3],
  ['filament-prusa-xl-5t', 'XL 5T', 1],
  ['filament-creality-k1c', 'K1C', 2],
  ['filament-voron-2-4-350', 'Voron 2.4', 1],
  ['filament-qidi-x-plus-4', 'Plus4', 1],
]
const printers: PrinterProfile[] = fleet.flatMap(([presetId, label, count, addOnPresetIds]) => {
  const preset = required(getPrinterPreset(presetId), `printer preset ${presetId}`)
  for (const id of addOnPresetIds ?? []) required(getEquipmentPreset(id), `add-on preset ${id}`)
  const price = listed(prices.printers, presetId)
  const addOns = (addOnPresetIds ?? []).map((id) => euros((prices.addOns as Record<string, ListPrice>)[id] ?? {}) ?? 0)
  const purchasePrice = euros(price)
  return Array.from({ length: count }, (_, index) => ({
    id: `${presetId}-${index + 1}`,
    name: count > 1 ? `${label} · ${String.fromCharCode(65 + index)}` : label,
    printType: preset.printType,
    presetId,
    widthMm: preset.widthMm,
    depthMm: preset.depthMm,
    heightMm: preset.heightMm,
    ...(purchasePrice !== undefined && { purchasePrice: cents(purchasePrice + addOns.reduce((sum, amount) => sum + amount, 0)) }),
    lifespanHours: price.lifespanHours,
    ...(addOnPresetIds && { addOnPresetIds }),
  }))
})
const printer = (id: string) =>
  required(
    printers.find((candidate) => candidate.id === id),
    `printer ${id}`,
  )

/** Where stock ends after the seeded six weeks: comfortably above its minimum, below it, or used up. */
type StockTarget = 'healthy' | 'low' | 'missing'
const stockTargets = new Map<string, StockTarget>()

function resin(presetId: string, target?: StockTarget): ResinConsumable {
  const preset = required(findPreset(resinCatalog.presets as ResinPreset[], presetId), `resin preset ${presetId}`)
  const price = listed(prices.resins, presetId)
  const density = preset.densityGramsPerMl ?? TYPICAL_RESIN_DENSITY_GRAMS_PER_ML
  const packMl = Math.round(price.packUnit === 'g' ? price.packAmount! / density : price.packAmount!)
  if (target) stockTargets.set(presetId, target)
  return {
    id: presetId,
    kind: 'resin',
    name: `${preset.brand} ${preset.name}`,
    resinPresetId: presetId,
    pricePerLitre: cents((euros(price)! / packMl) * 1_000),
    densityGramsPerMl: density,
    packSize: packMl,
    ...(target && { minimumStock: 2 * packMl }),
  }
}

function filament(presetId: string, colourName: string, target?: StockTarget): FilamentConsumable {
  const preset = required(findPreset(filamentCatalog.presets as FilamentPreset[], presetId), `filament preset ${presetId}`)
  const option = required(
    preset.colors?.find((candidate) => candidate.names.en === colourName),
    `${colourName} in ${presetId}`,
  )
  const colour = { name: option.names.en, hex: option.hex }
  const price = listed(prices.filaments, presetId)
  const id = `${presetId}-${colourName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  if (target) stockTargets.set(id, target)
  return {
    id,
    kind: 'filament',
    name: filamentConsumableName(preset, colour),
    filamentPresetId: presetId,
    colour,
    pricePerKg: cents((euros(price)! / price.packAmount!) * 1_000),
    packSize: price.packAmount,
    ...(target && { minimumStock: 2 * price.packAmount! }),
  }
}

function supply(key: keyof typeof prices.supplies, name: string, unit: SupplyConsumable['unit'], target: StockTarget): SupplyConsumable {
  const price: ListPrice = prices.supplies[key]
  const id = `supply-${key}`
  stockTargets.set(id, target)
  // Supplies are priced as bought: per litre for millilitres, per item otherwise.
  const perUnit = euros(price)! / price.packAmount!
  return {
    id,
    kind: 'supply',
    name,
    unit,
    price: unit === 'item' ? cents(perUnit) : cents(perUnit * 1_000),
    packSize: price.packAmount,
    minimumStock: unit === 'ml' ? 2 * price.packAmount! : Math.max(6, 2 * price.packAmount!),
  }
}

// Spare parts on the shelf are set directly: wear by the plate or hour never moves their stock.
const spares = new Map<string, { bought: number; minimum?: number }>()
function part(presetId: string, printerPresetId: string, bought: number, minimum?: number): PartConsumable {
  const preset = required(findPreset(partCatalog.presets as PartPreset[], presetId), `part preset ${presetId}`)
  if (!preset.fits.includes(printerPresetId)) throw new Error(`${presetId} does not fit ${printerPresetId}`)
  const override = (prices.parts as Record<string, ListPrice>)[presetId]
  const list = override ?? {
    amount: preset.listPrice?.amount,
    currency: preset.listPrice?.currency,
    packAmount: preset.listPrice?.packSize,
  }
  const id = `${presetId}-${printerPresetId}`
  spares.set(id, { bought, minimum })
  return {
    ...partFromPreset(id, { preset, printerPresetId }),
    price: cents(euros(list)! / (list.packAmount ?? 1)),
    ...(list.packAmount && list.packAmount > 1 && { packSize: list.packAmount }),
    ...(minimum !== undefined && { minimumStock: minimum }),
  }
}

const library: Consumable[] = [
  resin('resin-formlabs-grey-v5', 'healthy'),
  resin('resin-formlabs-clear-v5', 'low'),
  resin('resin-formlabs-black-v5', 'healthy'),
  resin('resin-formlabs-tough-2000-v2', 'missing'),
  resin('resin-heygears-pab10', 'healthy'),
  resin('resin-prusament-resin-model-rich-black', 'healthy'),
  resin('resin-prusament-resin-model-anthracite-grey', 'low'),
  resin('resin-esun-standard-resin-black', 'healthy'),
  resin('resin-siraya-tech-fast-grey', 'healthy'),
  resin('resin-siraya-tech-blu-clear-v2'),
  resin('resin-siraya-tech-tenacious'),
  filament('filament-bambu-lab-pla', 'Black', 'healthy'),
  filament('filament-bambu-lab-pla', 'Jade White', 'low'),
  filament('filament-bambu-lab-pla', 'Bambu Green', 'healthy'),
  filament('filament-bambu-lab-matte-pla', 'Charcoal', 'healthy'),
  filament('filament-bambu-lab-matte-pla', 'Ivory White', 'healthy'),
  filament('filament-bambu-lab-petg', 'Black', 'healthy'),
  filament('filament-bambu-lab-translucent-petg', 'Translucent Gray'),
  filament('filament-bambu-lab-pla-cf', 'Lava Gray', 'healthy'),
  filament('filament-bambu-lab-pa6-cf', 'Black', 'missing'),
  filament('filament-bambu-lab-hf-tpu-95a', 'Black', 'healthy'),
  filament('filament-bambu-lab-support-for-pla-petg', 'Nature', 'healthy'),
  filament('filament-prusament-pla', 'Prusa Galaxy Black', 'healthy'),
  filament('filament-prusament-pla', 'Prusa Orange', 'low'),
  filament('filament-prusament-petg', 'Jet Black', 'healthy'),
  filament('filament-prusament-petg', 'Prusa Orange', 'healthy'),
  filament('filament-prusament-asa', 'Jet Black', 'healthy'),
  filament('filament-polymaker-polylite-pla', 'Grey', 'healthy'),
  filament('filament-polymaker-polylite-asa', 'Jet Black', 'healthy'),
  filament('filament-esun-pla', 'Cold White', 'healthy'),
  filament('filament-esun-pla', 'Black', 'healthy'),
  filament('filament-overture-high-speed-tpu-95a', 'Black', 'healthy'),
  supply('ipa', 'Isopropyl alcohol 99.9%', 'ml', 'low'),
  supply('gloves', 'Nitrile gloves', 'item', 'healthy'),
  supply('desiccant', 'AMS desiccant pack', 'item', 'low'),
  part('part-formlabs-form-4-resin-tank', 'resin-formlabs-form-4', 3, 1),
  part('part-elegoo-pfa-film-saturn', 'resin-elegoo-saturn-4-ultra-16k', 5, 5),
  part('part-elegoo-lcd-saturn-4-ultra-16k', 'resin-elegoo-saturn-4-ultra-16k', 1, 1),
  part('part-elegoo-fep-film-mars-4-5', 'resin-elegoo-mars-5-ultra', 5, 2),
  part('part-elegoo-lcd-mars-5-ultra', 'resin-elegoo-mars-5-ultra', 0),
  part('part-anycubic-nfep-film-photon-mono-m7-pro', 'resin-anycubic-photon-mono-m7-pro', 5, 2),
  part('part-phrozen-pfa-film-mighty', 'resin-phrozen-sonic-mighty-revo', 2, 2),
  part('part-bambu-lab-hotend-x1c-0-4-hardened', 'filament-bambu-lab-x1-carbon', 4, 2),
  part('part-bambu-lab-textured-pei-plate', 'filament-bambu-lab-x1-carbon', 2, 1),
  part('part-bambu-lab-hotend-p1-0-4-hardened', 'filament-bambu-lab-p1s', 2, 2),
  part('part-bambu-lab-textured-pei-plate', 'filament-bambu-lab-p1s', 2, 1),
  part('part-prusa-nozzle-brass-0-4', 'filament-prusa-core-one', 3, 2),
  part('part-prusa-smooth-pei-sheet', 'filament-prusa-core-one', 1, 1),
  part('part-prusa-nozzle-brass-0-4', 'filament-prusa-xl-5t', 2, 1),
]
const consumable = (id: string) =>
  required(
    library.find((candidate) => candidate.id === id),
    `consumable ${id}`,
  )

function kit(id: string, presetId: string, use: Partial<EquipmentItem>): EquipmentItem {
  const preset = required(getEquipmentPreset(presetId), `equipment preset ${presetId}`)
  const price = (prices.equipment as Record<string, ListPrice>)[presetId] ?? {}
  return {
    ...equipmentFromPreset(id, preset),
    ...(price.amount !== undefined && { purchasePrice: euros(price), lifespanHours: price.lifespanHours }),
    ...use,
  }
}
const ipa = (amountPerUse: number) => [
  { consumableId: 'supply-ipa', amountPerUse },
  { consumableId: 'supply-gloves', amountPerUse: 2 },
]
const equipment: EquipmentItem[] = [
  kit('equipment-form-wash', 'postprocess-formlabs-form-wash-v2', { supplies: ipa(20) }),
  kit('equipment-form-cure', 'postprocess-formlabs-form-cure-v2', {}),
  kit('equipment-mercury-a', 'postprocess-elegoo-mercury-plus-v3', { name: 'Mercury Plus · A', supplies: ipa(15) }),
  kit('equipment-mercury-b', 'postprocess-elegoo-mercury-plus-v3', { name: 'Mercury Plus · B', supplies: ipa(15) }),
  kit('equipment-ultrasonic', 'postprocess-uniformation-w230', { kind: 'ultrasonic', minutesPerUse: 8, supplies: ipa(25) }),
  kit('equipment-filadryer', 'accessory-sunlu-filadryer-s4', {}),
  kit('equipment-old-wash-cure', 'postprocess-anycubic-wash-cure-3', { archived: true }),
]

const calculator: PriceCalculatorSettings = {
  ...DEFAULT_PRICE_CALCULATOR_SETTINGS,
  currency: 'EUR',
  electricityCountryCode: 'NL',
  electricityPricePerKwh: required(getElectricityPricePreset(electricityCatalog.presets, 'NL'), 'NL electricity preset').eurPerKwh,
  labourCostPerHour: 28,
  failureAllowancePercent: 8,
  markupPercent: 66.67,
}

// What each model prints with, weighted by repetition, and the finishing set it goes through.
const materialsByModel: Record<string, string[]> = {
  'resin-formlabs-form-4': [
    'resin-formlabs-grey-v5',
    'resin-formlabs-grey-v5',
    'resin-formlabs-grey-v5',
    'resin-formlabs-clear-v5',
    'resin-formlabs-black-v5',
    'resin-formlabs-tough-2000-v2',
  ],
  'resin-heygears-reflex-rs-turbo': ['resin-heygears-pab10'],
  lcd: [
    'resin-prusament-resin-model-rich-black',
    'resin-prusament-resin-model-anthracite-grey',
    'resin-esun-standard-resin-black',
    'resin-esun-standard-resin-black',
    'resin-siraya-tech-fast-grey',
  ],
  bambu: [
    'filament-bambu-lab-pla-black',
    'filament-bambu-lab-pla-black',
    'filament-bambu-lab-pla-jade-white',
    'filament-bambu-lab-pla-bambu-green',
    'filament-bambu-lab-matte-pla-charcoal',
    'filament-bambu-lab-matte-pla-ivory-white',
    'filament-bambu-lab-petg-black',
    'filament-bambu-lab-pla-cf-lava-gray',
    'filament-bambu-lab-hf-tpu-95a-black',
  ],
  'filament-bambu-lab-x1-carbon': ['filament-bambu-lab-pa6-cf-black'],
  'filament-bambu-lab-h2d': ['filament-bambu-lab-pa6-cf-black'],
  prusa: [
    'filament-prusament-pla-prusa-galaxy-black',
    'filament-prusament-pla-prusa-galaxy-black',
    'filament-prusament-pla-prusa-orange',
    'filament-prusament-petg-jet-black',
    'filament-prusament-petg-prusa-orange',
    'filament-prusament-asa-jet-black',
  ],
  open: [
    'filament-polymaker-polylite-pla-grey',
    'filament-polymaker-polylite-pla-grey',
    'filament-polymaker-polylite-asa-jet-black',
    'filament-esun-pla-cold-white',
    'filament-esun-pla-black',
    'filament-overture-high-speed-tpu-95a-black',
  ],
}
function materialFor(presetId: string) {
  const family = presetId.startsWith('resin-')
    ? (materialsByModel[presetId] ?? materialsByModel.lcd)
    : presetId.startsWith('filament-bambu-lab')
      ? [...materialsByModel.bambu, ...(materialsByModel[presetId] ?? [])]
      : presetId.startsWith('filament-prusa')
        ? materialsByModel.prusa
        : materialsByModel.open
  return consumable(pick(family))
}
function finishingFor(presetId: string) {
  if (presetId === 'resin-formlabs-form-4') return ['equipment-form-wash', 'equipment-form-cure']
  if (presetId === 'resin-elegoo-saturn-4-ultra-16k') return ['equipment-mercury-a']
  if (presetId === 'resin-elegoo-mars-5-ultra') return ['equipment-mercury-b']
  if (presetId.startsWith('resin-')) return ['equipment-ultrasonic', 'equipment-form-cure']
  return []
}
// Nylon and TPU go through the dryer before printing.
const needsDrying = (material: Consumable) => /pa6|tpu/.test(material.id)

// Each print is one of the preview shapes, scaled to the size of the thing it stands for.
const things: [string, PrintType, PreviewShape, number][] = [
  ['Miniature squad', 'resin', 'figure', 1.3],
  ['Bust: Knight', 'resin', 'figure', 3.2],
  ['Bust: Valkyrie', 'resin', 'figure', 3.4],
  ['Articulated dragon', 'resin', 'figure', 2.4],
  ['Jewellery casting master', 'resin', 'figure', 0.9],
  ['Ring sizing set', 'resin', 'cube', 0.9],
  ['Dental model', 'resin', 'bracket', 1.6],
  ['D&D terrain tiles', 'resin', 'bracket', 1.4],
  ['Tabletop vehicle', 'resin', 'cube', 1.8],
  ['Keycap set', 'resin', 'cube', 0.9],
  ['Architectural model', 'resin', 'cube', 2],
  ['Gridfinity bins 2×3', 'filament', 'cube', 3],
  ['Gridfinity baseplate', 'filament', 'bracket', 4],
  ['Desk cable tidy', 'filament', 'bracket', 1.5],
  ['Headphone hook', 'filament', 'bracket', 2.5],
  ['Planetary gear set', 'filament', 'cube', 2.5],
  ['Lithophane lamp shade', 'filament', 'figure', 4],
  ['Chess set', 'filament', 'figure', 2],
  ['GoPro mount', 'filament', 'bracket', 1],
  ['Drone frame arms', 'filament', 'bracket', 2.2],
  ['Raspberry Pi 5 case', 'filament', 'cube', 4.5],
  ['Wall-mounted spool holder', 'filament', 'bracket', 3],
  ['Cosplay helmet (left)', 'filament', 'figure', 9],
  ['Cosplay helmet (right)', 'filament', 'figure', 9],
  ['Benchy calibration', 'filament', 'cube', 1.5],
  ['Replacement dishwasher wheel', 'filament', 'figure', 1.5],
  ['Plant pot with saucer', 'filament', 'figure', 5],
  ['Phone stand', 'filament', 'bracket', 2],
  ['Bicycle light mount', 'filament', 'bracket', 1.2],
  ['Camera L-bracket', 'filament', 'bracket', 2],
  ['Laptop riser', 'filament', 'bracket', 5],
  ['Filament dryer lid', 'filament', 'cube', 4],
  ['Hex key holder', 'filament', 'cube', 2],
  ['Voron toolhead parts', 'filament', 'bracket', 1.5],
  ['Enclosure hinges', 'filament', 'bracket', 1.3],
  ['Fridge magnets', 'filament', 'cube', 1],
  ['Name badge blanks', 'filament', 'bracket', 1.5],
  ['Cookie cutters', 'filament', 'bracket', 2],
  ['Prosthetic hand test fit', 'filament', 'figure', 4],
  ['Robot arm joints', 'filament', 'cube', 2.5],
  ['Gear shifter knob', 'filament', 'figure', 2.5],
  ['Shower caddy hooks', 'filament', 'bracket', 1.8],
  ['Clip-on lens hood', 'filament', 'figure', 2.5],
  ['Snap-fit enclosure', 'filament', 'cube', 4],
  ['Wind turbine blades', 'filament', 'bracket', 4],
  ['Lamp base', 'filament', 'figure', 4],
  ['Vase mode vase', 'filament', 'figure', 6],
]
const notes: Record<PrintType | 'any', string[]> = {
  any: ['Customer pickup Friday', 'Rush — trade show on Monday', 'Sand and prime before handover'],
  resin: ['Hollow with 2 mm walls, drain holes underneath', 'Print in tough resin, it will be drilled', 'Supports only on the back'],
  filament: ['Matte black please', 'Needs to be food-safe PETG', 'Use the 0.6 mm nozzle', 'Supports only on the back'],
}
// A tag lives in one stage, so each one gathers the copies of its stage.
const tagSpecs: [string, PrintGroupColor, string][] = [
  ['Client · Acme Robotics', 'blue', 'in_progress'],
  ['Client · Hollow Oak Games', 'green', 'todo'],
  ['Etsy orders', 'orange', 'done'],
  ['Cosplay commission', 'violet', 'post_processing'],
  ['Rush', 'rose', 'up_next'],
]

const fits = (model: ModelDimensions, target: PrinterProfile) =>
  Math.max(model.widthMm, model.depthMm) <= Math.max(target.widthMm!, target.depthMm!) &&
  Math.min(model.widthMm, model.depthMm) <= Math.min(target.widthMm!, target.depthMm!) &&
  model.heightMm <= target.heightMm!

/** A thing of a print type, modelled at a size that fits the printer it is assigned to, and its analysed geometry. */
async function sizedThing(printType: PrintType, target?: PrinterProfile) {
  for (;;) {
    const [thingName, , shape, scale] = pick(things.filter((thing) => thing[1] === printType))
    const file = previewModelStl(shape, scale * (0.85 + random() * 0.3))
    const geometry = await generateVisualAssets(file, { thumbnail: false, preview: false })
    if (!target || fits(geometry.modelDimensions, target)) return { thingName, file, geometry }
  }
}

const requesterNames = [
  ['ava@example.com', 'Ava Chen'],
  ['marcus@example.com', 'Marcus Oyelaran'],
  ['priya@example.com', 'Priya Natarajan'],
  ['tomasz@example.com', 'Tomasz Wiśniewski'],
  ['lea@example.com', 'Léa Moreau'],
  ['sam@example.com', 'Sam Okafor'],
  ['hana@example.com', 'Hana Sato'],
  ['diego@example.com', 'Diego Alvarez'],
] as const
const requesters = [owner, ...(await Promise.all(requesterNames.map(([email, name]) => account(email, name))))]

const workspace = await repo.createWorkspace({ id: owner.id }, NAME, { storage: { adapter: 'local', root: printsDir } })
const scoped = await repo.scoped(workspace.id)
for (const requester of requesters.slice(1)) await scoped.addWorkspaceMember(requester.id, 'member')
await scoped.changeInventory('printers', () => printers)
await scoped.changeInventory('consumables', () => library)
await scoped.changeInventory('equipment', () => equipment)
await scoped.setSetting(PRICE_CALCULATOR_SETTING, calculator)

// Usage is recorded as the step sheets record it, through the same drafting and pricing the service uses, but dated
// across the past six weeks.
const events: UsageEvent[] = []
function record(drafts: UsageDraft[], createdAt: number) {
  const transactionId = crypto.randomUUID()
  for (const draft of drafts) {
    events.push({
      ...draft,
      id: crypto.randomUUID(),
      transactionId,
      userId: owner.id,
      createdAt,
      ...(draft.unitPrice !== undefined && { currency: calculator.currency }),
    })
  }
}
function recordStep(input: StepUsageInput, estimate: { material?: number; minutes?: number } | undefined, createdAt: number) {
  const target = input.printerId ? printer(input.printerId) : undefined
  const kits = (input.equipmentIds ?? []).map((id) =>
    required(
      equipment.find((item) => item.id === id),
      `equipment ${id}`,
    ),
  )
  const material = input.consumableId ? consumable(input.consumableId) : undefined
  record(
    stepUsageDrafts(input, { rates: calculator, printer: target, estimate, material, equipment: kits, consumables: library }),
    createdAt,
  )
}
function recordStock(
  id: string,
  kind: 'restock' | 'waste' | 'replace' | 'correction',
  amount: number,
  createdAt: number,
  printerId?: string,
) {
  record([{ stage: 'stock', kind, ...consumed(consumable(id)), amount, ...(printerId && { printerId }) }], createdAt)
}

type Spec = { status: string; printerId?: string; printType: PrintType }
const filamentPrinters = printers.filter(({ printType }) => printType === 'filament')
const resinPrinters = printers.filter(({ printType }) => printType === 'resin')
const specs: Spec[] = []
// Most printers busy, a handful idle — some of those with work waiting for them, some with nothing.
for (const [index, { id, printType }] of printers.entries())
  if (index % 5 !== 3) specs.push({ status: 'in_progress', printerId: id, printType })
for (let i = 0; i < 26; i++) {
  const { id, printType } = pick(i % 3 ? filamentPrinters : resinPrinters)
  specs.push({ status: 'up_next', printerId: id, printType })
}
for (let i = 0; i < 64; i++) {
  const { id, printType } = pick(i % 3 ? filamentPrinters : resinPrinters)
  specs.push({ status: 'todo', printerId: i % 4 === 0 ? undefined : id, printType })
}
for (let i = 0; i < 20; i++) {
  const { id, printType } = pick(i % 2 ? filamentPrinters : resinPrinters)
  specs.push({ status: 'post_processing', printerId: id, printType })
}
for (let i = 0; i < 180; i++) {
  const { id, printType } = pick(i % 3 ? filamentPrinters : resinPrinters)
  specs.push({ status: 'done', printerId: id, printType })
}

const tagItems = new Map<string, { requestId: string; count: number }[]>()
for (const [index, spec] of specs.entries()) {
  const assigned = spec.printerId ? printer(spec.printerId) : undefined
  const resinPrint = spec.printType === 'resin'
  const { thingName, file, geometry } = await sizedThing(spec.printType, assigned)
  const quantity = resinPrint ? between(1, 6) : random() < 0.1 ? between(12, 24) : between(1, 8)
  const title = `${thingName}${!resinPrint && quantity > 4 && random() < 0.3 ? ' (batch)' : ''}`
  const requester = requesters[index % 4 === 0 ? 0 : between(1, requesters.length - 1)]
  const linked = random() < 0.1
  const fileName = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${index}.stl`
  if (!linked) {
    const destination = path.join(printsDir, workspace.id, 'todo', fileName)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, file)
  }
  const note = random() < 0.35 ? pick([...notes.any, ...notes[spec.printType]]) : undefined
  const id = await scoped.createRequest({
    name: title,
    ...(linked ? { sourceUrl: `https://www.printables.com/model/${100000 + index}` } : { fileName, filePath: `todo/${fileName}` }),
    quantity,
    ownerUserId: requester.id,
    notes: note,
    requestedPrintType: spec.printType,
    printerId: assigned?.id,
    automaticPrinterAssignment: false,
  })
  // The analysis the asset worker runs, ahead of time, so estimates exist before usage is recorded; a linked model has
  // no file, so its estimate is the admin's.
  if (linked) {
    const estimate = automaticPrintEstimate(
      {
        printType: spec.printType,
        modelVolumeMm3: geometry.modelVolumeMm3,
        modelSurfaceAreaMm2: geometry.modelSurfaceAreaMm2,
        modelHeightMm: geometry.modelDimensions.heightMm,
      },
      calculator,
    )
    await scoped.updateRequest(id, {
      estimatedMaterialOverride: estimate?.material && cents(estimate.material),
      estimatedPrintMinutesOverride: estimate?.minutes && Math.round(estimate.minutes),
    })
  } else {
    await scoped.setModelDimensions(id, geometry.modelDimensions, geometry.modelVolumeMm3, geometry.modelSurfaceAreaMm2)
  }
  const request = required(await scoped.getRequest(id), `request ${id}`)
  const estimate = requestPrintEstimate({
    ...request,
    printType: spec.printType,
    ...automaticEstimateFields(request, spec.printType, calculator),
  })
  const minutes = estimate?.minutes ?? 60

  // When it started printing, from its stage: today's prints, the last few days' finishing, and six weeks of done work.
  const printedAt =
    spec.status === 'in_progress'
      ? NOW - Math.min(minutes * 60_000 * 0.8, between(1, 20) * HOUR)
      : spec.status === 'post_processing'
        ? NOW - between(26, 96) * HOUR
        : spec.status === 'done'
          ? NOW - between(3 * 24, 42 * 24) * HOUR
          : undefined
  const finishedAt = printedAt === undefined ? undefined : printedAt + (minutes * Math.min(quantity, 4) + between(30, 360)) * 60_000
  const createdAt =
    (printedAt ?? NOW) - (spec.status === 'todo' ? random() * 16 * DAY : between(2, spec.status === 'up_next' ? 9 * 24 : 72) * HOUR)
  // Part of a big order often runs ahead of the rest, so many prints have copies in two stages.
  const moved = spec.status === 'todo' ? 0 : quantity > 3 && random() < 0.5 ? Math.ceil(quantity / 2) : quantity
  const movedAt = spec.status === 'in_progress' ? printedAt : spec.status === 'up_next' ? NOW - between(1, 48) * HOUR : finishedAt
  if (moved) await scoped.moveCopies({ id, from: 'todo', to: spec.status, count: moved, movedAt: Math.min(NOW, movedAt!) })
  await repo.database.update(requestsTable).set({ createdAt }).where(eq(requestsTable.id, id)).run()
  const status = moved ? spec.status : 'todo'
  const tag = tagSpecs.find(([, , tagStatus]) => tagStatus === status)
  if (tag && random() < 0.3) tagItems.set(tag[0], [...(tagItems.get(tag[0]) ?? []), { requestId: id, count: moved || quantity }])

  if (!assigned || printedAt === undefined || !moved) continue
  const material = materialFor(assigned.presetId!)
  const printing: StepUsageInput = {
    requestId: id,
    stage: 'printing',
    copies: moved,
    printerId: assigned.id,
    consumableId: material.id,
    ...(needsDrying(material) && moved <= 2 && { equipmentIds: ['equipment-filadryer'] }),
  }
  if (random() < 0.1) recordStep({ ...printing, outcome: 'failed' }, estimate, printedAt - (minutes * 0.5 + between(30, 180)) * 60_000)
  recordStep(printing, estimate, printedAt)
  const equipmentIds = finishingFor(assigned.presetId!)
  if (spec.status !== 'in_progress' && equipmentIds.length) {
    recordStep({ requestId: id, stage: 'finishing', copies: moved, equipmentIds }, estimate, Math.min(NOW - HOUR, finishedAt!))
  }
}
for (const [tag, color, status] of tagSpecs) {
  const items = tagItems.get(tag)
  if (items?.length) await scoped.createGroup(tag, status, color, items)
}

// The farm archives prints three weeks after they reach Ready, so the older half of the done work is already in the
// archive: the same sweep the server runs (which only reads and writes requests and settings), replayed once a day.
await scoped.setSetting('board', { autoArchiveDays: AUTO_ARCHIVE_DAYS } satisfies Partial<BoardConfig>)
const sweeper = new STLQuestService(
  scoped,
  {} as AssetStore,
  {} as UploadStagingArea,
  { publish: () => undefined },
  { capture: () => undefined, exception: () => undefined },
  { remove: async () => undefined },
)
let archived = 0
for (let day = NOW - 42 * DAY; day <= NOW; day += DAY) archived += await sweeper.autoArchiveReadyRequests(day)

// Stock movements: a resin spill, an IPA change, a tangled spool end, torn gloves, and worn parts swapped for spares.
recordStock('resin-prusament-resin-model-rich-black', 'waste', 150, NOW - 26 * DAY)
recordStock('supply-ipa', 'waste', 2500, NOW - 18 * DAY)
recordStock('filament-bambu-lab-petg-black', 'waste', 240, NOW - 9 * DAY)
recordStock('supply-gloves', 'waste', 20, NOW - 4 * DAY)
const replacements: [string, string, number][] = [
  ['part-formlabs-form-4-resin-tank-resin-formlabs-form-4', 'resin-formlabs-form-4-1', 12],
  ['part-elegoo-pfa-film-saturn-resin-elegoo-saturn-4-ultra-16k', 'resin-elegoo-saturn-4-ultra-16k-2', 9],
  ['part-anycubic-nfep-film-photon-mono-m7-pro-resin-anycubic-photon-mono-m7-pro', 'resin-anycubic-photon-mono-m7-pro-1', 30],
  ['part-anycubic-nfep-film-photon-mono-m7-pro-resin-anycubic-photon-mono-m7-pro', 'resin-anycubic-photon-mono-m7-pro-1', 8],
  ['part-phrozen-pfa-film-mighty-resin-phrozen-sonic-mighty-revo', 'resin-phrozen-sonic-mighty-revo-1', 15],
  ['part-bambu-lab-hotend-x1c-0-4-hardened-filament-bambu-lab-x1-carbon', 'filament-bambu-lab-x1-carbon-3', 21],
]
for (const [id, printerId, daysAgo] of replacements) recordStock(id, 'replace', 1, NOW - daysAgo * DAY, printer(printerId).id)
for (const [id, { bought }] of spares) if (bought) recordStock(id, 'restock', bought, NOW - 44 * DAY)

// Restocks in whole packs ahead of the use they cover, so stock ends healthy, low, or used up as planned.
const START = NOW - 44 * DAY
const TOP_UP = NOW - 20 * DAY
for (const [id, target] of stockTargets) {
  const item = consumable(id)
  const pack = packSize(item) ?? 1
  const minimum = item.minimumStock ?? 0
  const unit = consumableUnit(item)
  const used = (before = Infinity) =>
    events
      .filter((event) => event.consumableId === id && event.unit === unit && event.kind !== 'restock' && event.createdAt < before)
      .reduce((sum, event) => sum + event.amount, 0)
  const ending = target === 'healthy' ? 1.5 * minimum : target === 'low' ? 0.3 * minimum : 0
  const packs = Math.max(1, Math.ceil((used() + ending) / pack))
  const first = Math.min(packs, Math.ceil(used(TOP_UP) / pack) + 1)
  recordStock(id, 'restock', first * pack, START)
  if (packs > first) recordStock(id, 'restock', (packs - first) * pack, TOP_UP)
  if (target === 'missing') recordStock(id, 'correction', -(packs * pack - used()), NOW - 30 * 60_000)
}
await scoped.appendUsageEvents(events)
await scoped.setSetting(USAGE_TRACKING_SETTING, true)
await repo.close()

const kinds = (kind: Consumable['kind']) => library.filter((item) => item.kind === kind).length
console.log(
  `seeded ${NAME} for ${OWNER_EMAIL}: ${printers.length} printers, ${equipment.length} equipment, ` +
    `${kinds('resin')} resins, ${kinds('filament')} filaments, ${kinds('supply')} supplies, ${kinds('part')} wear parts, ` +
    `${specs.length} prints (${archived} archived), ${requesters.length - 1} requesters, ${events.length} usage events`,
)
