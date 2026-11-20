import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { PartPreset } from '../src/core/partPresets'

const root = path.resolve(import.meta.dirname, '..')
const read = <T>(file: string) => JSON.parse(readFileSync(path.join(root, file), 'utf8')) as T
const catalog = read<{ layersPerPlate: { value: number }; sources: { id: string }[]; presets: PartPreset[] }>('catalogs/parts/catalog.json')
const printers = new Map(
  read<{ presets: { id: string; printType: string }[] }>('catalogs/printers/catalog.generated.json').presets.map((printer) => [
    printer.id,
    printer.printType,
  ]),
)
const sourceIds = new Set(catalog.sources.map((source) => source.id))
const currencies = new Set(Intl.supportedValuesOf('currency'))
const today = new Date().toISOString().slice(0, 10)
const ids = new Set<string>()

function fail(preset: PartPreset, problem: string): never {
  throw new Error(`Part preset ${preset.id}: ${problem}`)
}

function isHttps(url: string | undefined) {
  return url !== undefined && URL.canParse(url) && new URL(url).protocol === 'https:'
}

for (const preset of catalog.presets) {
  if (!/^part-[a-z0-9]+(-[a-z0-9]+)*$/.test(preset.id)) fail(preset, 'ID must be part-<slug>')
  if (ids.has(preset.id)) fail(preset, 'duplicate ID')
  ids.add(preset.id)
  if (!preset.brand || !preset.name || !preset.category) fail(preset, 'missing brand, name, or category')
  if (preset.printType !== 'resin' && preset.printType !== 'filament') fail(preset, `unknown print type ${String(preset.printType)}`)
  if (new Set(preset.fits).size !== preset.fits.length) fail(preset, 'duplicate fitted printer')
  for (const printerId of preset.fits) {
    if (!printers.has(printerId)) fail(preset, `fits unknown printer preset ${printerId}`)
    if (printers.get(printerId) !== preset.printType) fail(preset, `fits ${printerId} of another print type`)
  }

  if (!Number.isFinite(preset.lifespan) || preset.lifespan <= 0) fail(preset, 'lifespan must be positive')
  if (preset.lifespanUnit !== 'plates' && preset.lifespanUnit !== 'hours') fail(preset, 'lifespan unit must be plates or hours')
  const lifespan = preset.lifespanSource
  if (!['stated', 'derived', 'typical'].includes(lifespan.basis) || !lifespan.note) fail(preset, 'lifespan needs a basis and note')
  if (lifespan.basis !== 'typical' && !isHttps(lifespan.url)) fail(preset, 'a manufacturer lifespan needs an https source URL')
  if (lifespan.url !== undefined && !isHttps(lifespan.url)) fail(preset, 'invalid lifespan source URL')
  if (lifespan.basis === 'derived' && lifespan.statedLayers === undefined) fail(preset, 'a derived lifespan needs statedLayers')
  if (
    lifespan.statedLayers !== undefined &&
    (preset.lifespanUnit !== 'plates' || preset.lifespan !== Math.round(lifespan.statedLayers / catalog.layersPerPlate.value))
  )
    fail(preset, 'lifespan must be statedLayers divided by layersPerPlate')

  const price = preset.listPrice
  if (price) {
    if (!Number.isFinite(price.amount) || price.amount <= 0 || Math.abs(price.amount * 100 - Math.round(price.amount * 100)) > 1e-6)
      fail(preset, 'list price must be a positive amount in cents')
    if (!currencies.has(price.currency)) fail(preset, `unknown ISO 4217 currency ${price.currency}`)
    if (price.packSize !== undefined && (!Number.isInteger(price.packSize) || price.packSize < 2))
      fail(preset, 'pack size must be an integer above one')
    if (!isHttps(price.url)) fail(preset, 'invalid list price URL')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(price.checked) || Number.isNaN(Date.parse(price.checked)) || price.checked > today)
      fail(preset, 'list price checked date must be a past YYYY-MM-DD date')
  }

  if (!sourceIds.has(preset.source.id)) fail(preset, `unknown source ${preset.source.id}`)
  if (!isHttps(preset.source.url)) fail(preset, 'invalid source URL')
}
if (!catalog.presets.length) throw new Error('Part catalog is empty')
console.log(`Validated ${catalog.presets.length} wear part presets.`)
