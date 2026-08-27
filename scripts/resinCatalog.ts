export type ResinCatalogSource = {
  id: string
  webRepository: string
  revision: string
  catalogPath: string
}

export type GeneratedResinPreset = {
  id: string
  brand: string
  name: string
  type?: string
  densityGramsPerMl?: number
  densitySource?: { url: string; note: string }
  source: { id: string; url: string }
}

export function parsePrusaSlaMaterials(contents: string, source: ResinCatalogSource) {
  const presets = new Map<string, GeneratedResinPreset>()
  let section: string | undefined
  let values: Record<string, string> = {}
  const flush = () => {
    if (!section || section.includes('*')) return
    const brand = normalizeBrand(values.material_vendor)
    if (!brand) return
    const profileName = section.replace(/\s+@.*$/, '').trim()
    const name = stripBrand(profileName, brand, values.material_vendor).trim()
    if (!name) return
    const density = Number(values.material_density)
    const preset: GeneratedResinPreset = {
      id: resinPresetId(brand, name),
      brand,
      name,
      ...(values.material_type ? { type: values.material_type } : {}),
      ...(Number.isFinite(density) && density > 0 ? { densityGramsPerMl: density } : {}),
      source: {
        id: source.id,
        url: `${source.webRepository}/blob/${source.revision}/${encodePath(source.catalogPath)}`,
      },
    }
    const existing = presets.get(preset.id)
    if (!existing || (!existing.densityGramsPerMl && preset.densityGramsPerMl)) presets.set(preset.id, preset)
  }

  for (const line of contents.split(/\r?\n/)) {
    const sectionMatch = line.match(/^\[sla_material:([^\]]+)\]$/)
    if (sectionMatch) {
      flush()
      section = sectionMatch[1]
      values = {}
      continue
    }
    const valueMatch = line.match(/^([^#=]+?)\s*=\s*(.*)$/)
    if (section && valueMatch) values[valueMatch[1].trim()] = valueMatch[2].trim()
  }
  flush()
  return [...presets.values()].sort(comparePresets)
}

export function mergeResinPresets(generated: GeneratedResinPreset[], curated: GeneratedResinPreset[]) {
  const presets = new Map(generated.map((preset) => [preset.id, preset]))
  for (const preset of curated) presets.set(preset.id, preset)
  return [...presets.values()].sort(comparePresets)
}

function normalizeBrand(brand?: string) {
  if (!brand) return undefined
  return (
    {
      Esun: 'eSUN',
      Monocure: 'Monocure 3D',
      'Prusa Polymers': 'Prusament',
    }[brand] ?? brand
  )
}

function stripBrand(name: string, brand: string, originalBrand?: string) {
  for (const prefix of [brand, originalBrand].filter((candidate): candidate is string => !!candidate)) {
    if (!name.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) continue
    const remainder = name.slice(prefix.length)
    if (/^[\s:–—-]/.test(remainder)) return remainder.replace(/^[\s:–—-]+/, '')
  }
  return name
}

function resinPresetId(brand: string, name: string) {
  return `resin-${slug(`${brand}-${name}`)}`
}

function slug(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function comparePresets(first: GeneratedResinPreset, second: GeneratedResinPreset) {
  return first.brand.localeCompare(second.brand) || first.name.localeCompare(second.name)
}

function encodePath(value: string) {
  return value.split('/').map(encodeURIComponent).join('/')
}
