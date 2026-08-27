import { readFileSync } from 'node:fs'
import path from 'node:path'

type EquipmentPreset = {
  id: string
  brand: string
  model: string
  printType?: 'resin' | 'filament'
  powerProfiles: { phase: 'printing' | 'washing' | 'drying' | 'curing'; watts: number; basis: string }[]
  source: { url: string; accessedAt: string }
}

const root = path.resolve(import.meta.dirname, '..')
const catalog = JSON.parse(readFileSync(path.join(root, 'equipment-catalog/catalog.json'), 'utf8')) as {
  presets: EquipmentPreset[]
}
const ids = new Set<string>()
for (const preset of catalog.presets) {
  if (ids.has(preset.id)) throw new Error(`Duplicate equipment preset ID ${preset.id}`)
  ids.add(preset.id)
  if (!preset.brand || !preset.model || !preset.source.accessedAt || !preset.powerProfiles.length)
    throw new Error(`Incomplete equipment preset ${preset.id}`)
  if (new Set(preset.powerProfiles.map((profile) => profile.phase)).size !== preset.powerProfiles.length)
    throw new Error(`Duplicate phase for ${preset.id}`)
  if (preset.powerProfiles.some((profile) => !profile.basis || !Number.isFinite(profile.watts) || profile.watts < 0))
    throw new Error(`Invalid power profile for ${preset.id}`)
  if (!preset.source.url.startsWith('https://')) throw new Error(`Invalid source URL for ${preset.id}`)
}
if (!catalog.presets.length) throw new Error('Equipment catalog is empty')
console.log(`Validated ${catalog.presets.length} equipment power presets.`)
