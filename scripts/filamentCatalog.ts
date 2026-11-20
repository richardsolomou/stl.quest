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

type SpoolmanFile = {
  manufacturer: string
  filaments: { name: string; material: string; density?: number; colors?: { name: string; hex?: string }[] }[]
}

/**
 * Reads SpoolmanDB: one file per manufacturer, each product named by a template such as "Matte {color_name}" and repeated
 * per spool size or diameter. Each product becomes "<line> <material>" (or just the line when it already names the
 * material) and gathers the colours of every entry for it.
 */
export function parseSpoolmanFilaments(files: { path: string; contents: string }[], source: FilamentCatalogSource) {
  const presets = new Map<string, GeneratedFilamentPreset>()
  for (const file of files) {
    const { manufacturer, filaments } = JSON.parse(file.contents) as SpoolmanFile
    const brand = normalizeBrand(manufacturer)
    if (!brand || !Array.isArray(filaments)) continue
    for (const filament of filaments) {
      const line = productLine(filament.name)
      const material = filament.material.trim()
      const name = line.toLocaleLowerCase().includes(material.toLocaleLowerCase()) ? line : `${line} ${material}`.trim()
      if (!name) continue
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
  }
  return [...presets.values()].sort((first, second) => first.brand.localeCompare(second.brand) || first.name.localeCompare(second.name))
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
