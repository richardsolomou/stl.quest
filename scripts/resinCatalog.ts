import { nextCmsPlugins } from './printerCatalog'

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

export type FormlabsMaterial = { name: string; pageUrl: string; dataSheetHandle?: string; categories: string[] }
export type FormlabsSafetyDataSheet = { handle: string; label: string; url: string }
export type SafetyDataSheetDensity = { gramsPerMl: number; note: string }

type FormlabsListing = {
  link: string | null
  enrichment: { name: string; tags: Record<string, { tags: { label: string }[] }>; links: { link: string | null }[] }
}

type FormlabsDataSheet = { display_name: string | null; products: string[]; language: string; file: string; sheet_type: string }

export const FORMLABS_SOURCE_ID = 'formlabs-materials'

// Pigments are additives, kits and packs bundle other resins, and Alumina is a ceramic that is sintered after printing.
const FORMLABS_EXCLUDED = /\b(?:pigment|kit|pack|alumina|ceramic)\b/i

export function parseFormlabsMaterials(html: string, pageUrl: string): FormlabsMaterial[] {
  return nextCmsPlugins(html).flatMap((plugin) => {
    if (plugin.pluginType !== 'V3ShopifyProductList') return []
    const { products } = JSON.parse(plugin.props) as { products: FormlabsListing[] }
    return products.flatMap(({ link, enrichment }) => {
      const labels = (tag: string) => enrichment.tags[tag]?.tags.map((value) => value.label) ?? []
      if (!link || !labels('print-technology').includes('SLA') || FORMLABS_EXCLUDED.test(enrichment.name)) return []
      const dataSheetHandle = enrichment.links
        .map((candidate) => candidate.link?.match(/\/data-sheets\/\?product=([^&#]+)/)?.[1])
        .find(Boolean)
      return [
        {
          name: enrichment.name,
          pageUrl: new URL(link, pageUrl).href,
          ...(dataSheetHandle ? { dataSheetHandle } : {}),
          categories: labels('categories'),
        },
      ]
    })
  })
}

export function parseFormlabsSafetyDataSheets(html: string): FormlabsSafetyDataSheet[] {
  return nextCmsPlugins(html).flatMap((plugin) => {
    if (plugin.pluginType !== 'Datasheets') return []
    const { products, pdfs } = JSON.parse(plugin.props) as { products: { handle: string; label: string }[]; pdfs: FormlabsDataSheet[] }
    return products.flatMap(({ handle, label }) => {
      const english = pdfs.filter((pdf) => pdf.sheet_type === 'safety' && pdf.language === 'en' && pdf.products.includes(handle))
      const region = (pdf: FormlabsDataSheet) => pdf.display_name?.match(/\((EN-?US|EN)\)\s*$/)?.[1]
      const sheet = english.find((pdf) => region(pdf)?.endsWith('US')) ?? english.find((pdf) => region(pdf) === 'EN')
      return sheet ? [{ handle, label, url: sheet.file }] : []
    })
  })
}

export function selectFormlabsResins(materials: FormlabsMaterial[], sheets: FormlabsSafetyDataSheet[]) {
  const resins = new Map<string, { material: FormlabsMaterial; sheetUrl: string }>()
  const skipped: { name: string; reason: string }[] = []
  for (const material of materials) {
    const sheet =
      sheets.find((candidate) => candidate.handle === material.dataSheetHandle) ??
      sheets.find((candidate) => candidate.label === material.name)
    if (!sheet) {
      skipped.push({ name: material.name, reason: 'no US English safety data sheet' })
      continue
    }
    const existing = resins.get(sheet.url)
    if (!existing || material.name.length < existing.material.name.length) resins.set(sheet.url, { material, sheetUrl: sheet.url })
  }
  return { resins: [...resins.values()], skipped }
}

/** Reads the density row of an SDS's section 9 as extracted by `pdftotext -layout`; g/cm³ and kg/L both equal g/mL. */
export function parseSafetyDataSheetDensity(text: string): SafetyDataSheetDensity | undefined {
  const lines = text.split(/\r?\n/)
  const row = lines.findIndex((line) => /^\s*Density\b/i.test(line))
  if (row === -1) return undefined
  const value = lines
    .slice(row, row + 3)
    .join(' ')
    .match(/^\s*Density\b\D*?(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*(?:gm?\/cm[3³]|kg\/L\b)/i)
  if (!value || /not determined|no data/i.test(lines[row])) return undefined
  const source = "section 9 of the manufacturer's US safety data sheet"
  const low = Number(value[1])
  if (!value[2]) return { gramsPerMl: low, note: `Stated as ${low} g/cm³ in ${source}.` }
  const high = Number(value[2])
  return { gramsPerMl: (low + high) / 2, note: `Midpoint of the ${low}–${high} g/cm³ range stated in ${source}.` }
}

export function formlabsResinPreset(material: FormlabsMaterial, sheetUrl: string, density: SafetyDataSheetDensity): GeneratedResinPreset {
  const name = material.name
    .replace(/[™®]/g, '')
    .replace(/\s*\bResin\b/g, '')
    .trim()
  const type = formlabsResinType(material.categories)
  return {
    id: resinPresetId('Formlabs', name),
    brand: 'Formlabs',
    name,
    ...(type ? { type } : {}),
    densityGramsPerMl: density.gramsPerMl,
    densitySource: { url: sheetUrl, note: density.note },
    source: { id: FORMLABS_SOURCE_ID, url: material.pageUrl },
  }
}

// Ordered so that a resin's primary purpose wins over secondary categories such as Dental on general-purpose model resins.
const FORMLABS_TYPES: [category: string, type: string][] = [
  ['Casting', 'Casting'],
  ['Elastomeric', 'Flexible'],
  ['Medical', 'Medical'],
  ['General Purpose', 'Model'],
  ['Dental', 'Medical'],
  ['Impact Resistant', 'Tough'],
  ['High Stiffness', 'Engineering'],
  ['Temperature Resistant', 'Engineering'],
  ['Specialty', 'Engineering'],
]

function formlabsResinType(categories: string[]) {
  return FORMLABS_TYPES.find(([category]) => categories.includes(category))?.[1]
}

export function mergeResinPresets(generated: GeneratedResinPreset[], curated: GeneratedResinPreset[]) {
  const presets = new Map(generated.map((preset) => [preset.id, preset]))
  for (const preset of curated) presets.set(preset.id, preset)
  return [...presets.values()].sort(comparePresets)
}

export function normalizeBrand(brand?: string) {
  if (!brand) return undefined
  return (
    {
      Esun: 'eSUN',
      eSun: 'eSUN',
      Monocure: 'Monocure 3D',
      'Prusa Polymers': 'Prusament',
    }[brand] ?? brand
  )
}

export function stripBrand(name: string, brand: string, originalBrand?: string) {
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

export function slug(value: string) {
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

export function encodePath(value: string) {
  return value.split('/').map(encodeURIComponent).join('/')
}
