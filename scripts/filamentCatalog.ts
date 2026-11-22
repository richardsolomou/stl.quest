import { normalizedWords } from '../src/core/orders/orderText'
import { spoolmanDbStem, type SpoolmanCatalogue } from '../src/core/spoolman'
import { encodePath, normalizeBrand, slug } from './resinCatalog'

export type FilamentCatalogSource = {
  id: string
  webRepository: string
  revision: string
  catalogPath: string
}

export type FilamentColor = { hex: string; names: { en: string }; code?: string }

/** A colour as parsing finds it, with the SpoolmanDB ID stems of every entry it was gathered from. */
type ParsedColor = FilamentColor & { spoolmanIds: string[] }

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

type ParsedPreset = Omit<GeneratedFilamentPreset, 'colors'> & { colors?: ParsedColor[] }

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
      // A block holding one colour flagged differently describes that colour, so only a range of colours makes a product.
      const variant = (filament.colors?.length ?? 0) > 1 ? variantWords(filament, name) : []
      return name ? [{ file, manufacturer, filament, brand, material, name, variant }] : []
    })
  })
  const presets = new Map<string, ParsedPreset>()
  for (const { file, manufacturer, filament, brand, material, name: lineName, variant } of entries) {
    const siblings = entries.filter((entry) => entry.brand === brand && entry.name === lineName)
    const qualifier = variant.filter((word) => !siblings.every((sibling) => sibling.variant.includes(word)))
    const name = [...qualifier, lineName].join(' ')
    const id = `filament-${slug(`${brand}-${name}`)}`
    const colors = (filament.colors ?? []).flatMap((color) =>
      color.name && /^[0-9a-f]{6}/i.test(color.hex ?? '')
        ? [
            {
              hex: `#${color.hex!.slice(0, 6).toUpperCase()}`,
              names: { en: color.name },
              spoolmanIds: [spoolmanDbStem(manufacturer, filament.material, filament.name.replace('{color_name}', color.name))],
            },
          ]
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
  const sorted = [...presets.values()].sort(
    (first, second) => first.brand.localeCompare(second.brand) || first.name.localeCompare(second.name),
  )
  return {
    presets: sorted.map((preset) =>
      preset.colors ? { ...preset, colors: preset.colors.map(({ hex, names }) => ({ hex, names })) } : preset,
    ) as GeneratedFilamentPreset[],
    spoolman: spoolmanCatalogue(sorted),
  }
}

/**
 * What matching Spoolman filaments needs: each SpoolmanDB ID stem's product and colour, leaving out a stem two colours
 * share, and each product's brand and material.
 */
function spoolmanCatalogue(presets: ParsedPreset[]): SpoolmanCatalogue {
  const found = new Map<string, [string, string][]>()
  for (const preset of presets)
    for (const color of preset.colors ?? [])
      for (const stem of new Set(color.spoolmanIds)) found.set(stem, [...(found.get(stem) ?? []), [preset.id, color.names.en]])
  return {
    colours: Object.fromEntries(
      [...found]
        .flatMap(([stem, owners]): [string, [string, string]][] => (owners.length === 1 ? [[stem, owners[0]]] : []))
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
    presets: Object.fromEntries(presets.flatMap((preset) => (preset.colors ? [[preset.id, [preset.brand, preset.type ?? '']]] : []))),
  }
}

export function applyFilamentPatches(presets: GeneratedFilamentPreset[], patches: FilamentPatches) {
  for (const id of Object.keys(patches)) {
    if (!presets.some((preset) => preset.id === id)) throw new Error(`Filament patch for unknown preset ${id}`)
  }
  return presets.map((preset) => ({ ...preset, ...patches[preset.id] }))
}

/** One of Bambu Studio's `filaments_color_codes.json` entries: a product, a colour code, and its names and hex values. */
type ColourCodeEntry = { fila_type: string; fila_color_code: string; fila_color_name: { en?: string }; fila_color: string[] }

/**
 * Records a manufacturer's colour codes, as Bambu Studio lists them, on the catalogue colours they name. A code joins a
 * colour only when the product's words, the English name, and the hex value all agree, and two codes claiming one colour
 * leave it without either, since SpoolmanDB folds some products the manufacturer sells apart (Silk and Silk+ PLA).
 */
export function applyColourCodes(presets: GeneratedFilamentPreset[], brand: string, contents: string) {
  const { data } = JSON.parse(contents) as { data: ColourCodeEntry[] }
  const claims = new Map<FilamentColor, Set<string>>()
  for (const entry of data) {
    const hex = entry.fila_color[0]?.slice(0, 7).toUpperCase()
    const found = presets.flatMap((preset) =>
      preset.brand === brand && wordKey(preset.name) === wordKey(entry.fila_type)
        ? (preset.colors ?? []).filter(
            (colour) => colour.hex === hex && wordKey(colour.names.en) === wordKey(entry.fila_color_name.en ?? ''),
          )
        : [],
    )
    if (found.length === 1) claims.set(found[0], (claims.get(found[0]) ?? new Set()).add(entry.fila_color_code))
  }
  return presets.map((preset) =>
    preset.colors?.some((colour) => claims.get(colour)?.size === 1)
      ? {
          ...preset,
          colors: preset.colors.map((colour) => {
            const codes = claims.get(colour)
            return codes?.size === 1 ? { ...colour, code: [...codes][0] } : colour
          }),
        }
      : preset,
  )
}

const wordKey = (text: string) => normalizedWords(text).toSorted().join(' ')

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

function mergeColors(current: ParsedColor[] | undefined, added: ParsedColor[]) {
  const colors = [...(current ?? [])]
  for (const color of added) {
    const existing = colors.find(({ names }) => names.en === color.names.en)
    if (existing) existing.spoolmanIds.push(...color.spoolmanIds)
    else colors.push({ ...color, spoolmanIds: [...color.spoolmanIds] })
  }
  return colors.length ? colors : undefined
}
