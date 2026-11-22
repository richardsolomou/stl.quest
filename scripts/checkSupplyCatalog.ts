import { readFileSync } from 'node:fs'
import path from 'node:path'
import { SUPPLY_UNITS } from '../src/core/consumables'
import { SUPPLY_CATEGORIES, type SupplyPreset } from '../src/core/supplyPresets'
import { isHttps, listPriceProblem } from './catalogChecks'

const root = path.resolve(import.meta.dirname, '..')
const read = <T>(file: string) => JSON.parse(readFileSync(path.join(root, file), 'utf8')) as T
const catalog = read<{ sources: { id: string }[]; presets: SupplyPreset[] }>('catalogs/supplies/catalog.json')
const equipment = new Set(read<{ presets: { id: string }[] }>('catalogs/equipment/catalog.json').presets.map(({ id }) => id))
const sourceIds = new Set(catalog.sources.map((source) => source.id))
const ids = new Set<string>()

function fail(preset: SupplyPreset, problem: string): never {
  throw new Error(`Supply preset ${preset.id}: ${problem}`)
}

for (const preset of catalog.presets) {
  if (!/^supply-[a-z0-9]+(-[a-z0-9]+)*$/.test(preset.id)) fail(preset, 'ID must be supply-<slug>')
  if (ids.has(preset.id)) fail(preset, 'duplicate ID')
  ids.add(preset.id)
  if (!preset.name || !SUPPLY_CATEGORIES.includes(preset.category)) fail(preset, 'missing name or unknown category')
  if (!SUPPLY_UNITS.includes(preset.unit)) fail(preset, `unknown unit ${preset.unit}`)
  if (preset.printType !== undefined && preset.printType !== 'resin' && preset.printType !== 'filament')
    fail(preset, `unknown print type ${String(preset.printType)}`)
  if (preset.packSize !== undefined && !(Number.isFinite(preset.packSize) && preset.packSize > 0))
    fail(preset, 'pack size must be positive')

  for (const equipmentId of preset.usedBy) if (!equipment.has(equipmentId)) fail(preset, `used by unknown equipment preset ${equipmentId}`)
  if (preset.usedBy.length && !isHttps(preset.usedBySource)) fail(preset, 'equipment that uses it needs an https source URL')

  const price = preset.listPrice
  if (price) {
    if (!preset.brand || !preset.source) fail(preset, 'a list price needs the brand and store page that list it')
    if (preset.unit !== 'item' && !preset.packSize) fail(preset, 'a list price by volume or weight needs the pack size')
    const problem = listPriceProblem(price)
    if (problem) fail(preset, problem)
  } else if (!preset.note) fail(preset, 'a supply with no list price needs a note saying why')

  if (preset.source && (!sourceIds.has(preset.source.id) || !isHttps(preset.source.url)))
    fail(preset, 'unknown source or invalid source URL')
}
if (!catalog.presets.length) throw new Error('Supply catalog is empty')
console.log(`Validated ${catalog.presets.length} supply presets.`)
