import { encodePath, normalizeBrand, slug } from './resinCatalog'

export type FilamentCatalogSource = {
  id: string
  webRepository: string
  revision: string
  catalogPath: string
}

export type FilamentColor = { hex: string; names: { en: string } }

export type GeneratedFilamentPreset = {
  id: string
  brand: string
  name: string
  type?: string
  densityGramsPerCm3?: number
  /** The colours the manufacturer sells it in. */
  colors?: FilamentColor[]
  source: { id: string; url: string }
}

type SpoolmanFilament = {
  name: string
  material: string
  density?: number
  colors?: { name: string; hex?: string }[]
  pattern?: string
  translucent?: boolean
  glow?: boolean
  multi_color_direction?: string
}

type SpoolmanFile = { manufacturer: string; filaments: SpoolmanFilament[] }

/** Display patches by preset ID, which they never change, so workspaces keep the presets they chose. */
export type FilamentPatches = Record<string, Partial<Pick<GeneratedFilamentPreset, 'name'>>>

/**
 * Reads SpoolmanDB: one file per manufacturer, each product named by a template such as "Matte {color_name}" and repeated
 * per spool size or diameter. Each product becomes "<line> <material>" (or just the line when it already names the
 * material) and gathers the colours of every entry for it. A manufacturer can list several products under one template,
 * such as a basic, a marble, and a gradient "{color_name}" PLA; the attributes that tell them apart prefix the name
 * ("Marble PLA"), and the product with none of them keeps the plain name and ID.
 */
export function parseSpoolmanFilaments(files: { path: string; contents: string }[], source: FilamentCatalogSource) {
  const entries = files.flatMap((file) => {
    const { manufacturer, filaments } = JSON.parse(file.contents) as SpoolmanFile
    const brand = normalizeBrand(manufacturer)
    if (!brand || !Array.isArray(filaments)) return []
    return filaments.flatMap((filament) => {
      const line = productLine(filament.name)
      const material = filament.material.trim()
      const name = line.toLocaleLowerCase().includes(material.toLocaleLowerCase()) ? line : `${line} ${material}`.trim()
      return name ? [{ file, filament, brand, material, name, variant: variantWords(filament, name) }] : []
    })
  })
  const presets = new Map<string, GeneratedFilamentPreset>()
  for (const { file, filament, brand, material, name: lineName, variant } of entries) {
    const siblings = entries.filter((entry) => entry.brand === brand && entry.name === lineName)
    const qualifier = variant.filter((word) => !siblings.every((sibling) => sibling.variant.includes(word)))
    const name = [...qualifier, lineName].join(' ')
    const id = `filament-${slug(`${brand}-${name}`)}`
    const colors = (filament.colors ?? []).flatMap((color) =>
      color.name && /^[0-9a-f]{6}/i.test(color.hex ?? '')
        ? [{ hex: `#${color.hex!.slice(0, 6).toUpperCase()}`, names: { en: color.name } }]
        : [],
    )
    const existing = presets.get(id)
    if (existing) {
      existing.colors = mergeColors(existing.colors, colors)
      continue
    }
    presets.set(id, {
      id,
      brand,
      name,
      type: material,
      ...(filament.density && filament.density > 0 ? { densityGramsPerCm3: filament.density } : {}),
      ...(colors.length ? { colors: mergeColors(undefined, colors) } : {}),
      source: { id: source.id, url: `${source.webRepository}/blob/${source.revision}/${encodePath(file.path)}` },
    })
  }
  return [...presets.values()].sort((first, second) => first.brand.localeCompare(second.brand) || first.name.localeCompare(second.name))
}

export function applyFilamentPatches(presets: GeneratedFilamentPreset[], patches: FilamentPatches) {
  for (const id of Object.keys(patches)) {
    if (!presets.some((preset) => preset.id === id)) throw new Error(`Filament patch for unknown preset ${id}`)
  }
  return presets.map((preset) => ({ ...preset, ...patches[preset.id] }))
}

/**
 * The words SpoolmanDB's product attributes add to a name that does not already say them. `finish` is left out: entries of
 * one product often differ only in whether they set it.
 */
function variantWords(filament: SpoolmanFilament, name: string) {
  const words = [
    filament.multi_color_direction === 'coaxial' && 'Dual Color',
    filament.multi_color_direction === 'longitudinal' && 'Gradient',
    filament.pattern && filament.pattern.charAt(0).toLocaleUpperCase() + filament.pattern.slice(1),
    filament.translucent === true && 'Translucent',
    filament.glow === true && 'Glow',
  ].filter((word): word is string => Boolean(word))
  return words.filter((word) => !name.toLocaleLowerCase().includes(word.toLocaleLowerCase()))
}

function productLine(template: string) {
  return template
    .replace('{color_name}', '')
    .replace(/\(NFC\)/gi, '')
    .replace(/[™®]/g, '')
    .replace(/\s+-\s*$|^\s*-\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function mergeColors(current: FilamentColor[] | undefined, added: FilamentColor[]) {
  const colors = [...(current ?? [])]
  for (const color of added) if (!colors.some((existing) => existing.names.en === color.names.en)) colors.push(color)
  return colors.length ? colors : undefined
}
