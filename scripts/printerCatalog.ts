import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

export type CatalogSource = {
  id: string
  kind: 'filament' | 'resin'
  repository: string
  webRepository: string
  branch: string
  revision: string
  catalogPath: string
  license: string
  licensePath: string
  licenseOutput: string
}

export type CatalogOverrides = {
  brandAliases: Record<string, string>
  excludeIds: string[]
  patches: Record<string, Partial<GeneratedPrinterPreset>>
}

export type GeneratedPrinterPreset = {
  id: string
  brand: string
  model: string
  printType: 'filament' | 'resin'
  widthMm: number
  depthMm: number
  heightMm: number
  filamentDiameterMm?: number
  image?: { src: string; sourceId: string; sourceUrl: string }
  source: { id: string; url: string }
}

type ImageSourceBase = {
  id: string
  brand: string
  titleAliases?: Record<string, string>
}

export type ManufacturerImageSource =
  | (ImageSourceBase & {
      kind: 'shopify'
      feedUrl: string
      storefrontUrl: string
      productTypes: string[]
      catalog?: { excludeTitlePattern?: string }
    })
  | (ImageSourceBase & {
      kind: 'github'
      repository: string
      revision: string
      definitionPaths: string[]
      licensePath: string
      licenseOutput: string
    })

export type ManufacturerImage = {
  presetId: string
  sourceId: string
  sourcePageUrl: string
  sourceUrl: string
  src: string
  checkedAt: string
}

export type ManufacturerCatalogSource = {
  id: string
  kind: 'resin'
  repository: string
  revision: string
  license: string
}

type OrcaProfile = {
  name?: string
  inherits?: string
  printer_model?: string
  printer_variant?: string
  printable_area?: string[] | string
  printable_height?: string | number
}

export function parseOrcaCatalog(sourceRoot: string, source: CatalogSource, overrides: CatalogOverrides) {
  const profilesRoot = path.join(sourceRoot, source.catalogPath)
  const profiles = readJsonFiles<OrcaProfile>(profilesRoot, (file) => file.includes(`${path.sep}machine${path.sep}`))
  const profilesByName = new Map(profiles.flatMap((profile) => (profile.value.name ? [[profile.value.name, profile.value] as const] : [])))
  const resolvedProfiles = new Map<string, OrcaProfile>()
  const resolveProfile = (profile: OrcaProfile, seen = new Set<string>()): OrcaProfile => {
    const name = profile.name
    if (name && resolvedProfiles.has(name)) return resolvedProfiles.get(name)!
    if (!name || seen.has(name)) return profile
    seen.add(name)
    const parent = profile.inherits ? profilesByName.get(profile.inherits) : undefined
    const resolved = { ...(parent ? resolveProfile(parent, seen) : {}), ...profile }
    resolvedProfiles.set(name, resolved)
    return resolved
  }

  const presets: GeneratedPrinterPreset[] = []
  const images = new Map<string, string>()
  for (const vendorFile of readdirSync(profilesRoot)
    .filter((file) => file.endsWith('.json'))
    .sort()) {
    const vendorPath = path.join(profilesRoot, vendorFile)
    const vendor = JSON.parse(readFileSync(vendorPath, 'utf8')) as {
      name?: string
      machine_model_list?: { name: string; sub_path: string }[]
    }
    if (!vendor.machine_model_list?.length) continue
    const rawBrand = vendor.name ?? path.basename(vendorFile, '.json')
    const brand = overrides.brandAliases[rawBrand] ?? rawBrand
    const vendorDirectory = path.join(profilesRoot, path.basename(vendorFile, '.json'))

    for (const modelEntry of vendor.machine_model_list) {
      const candidates = profiles
        .filter((profile) => profile.value.printer_model === modelEntry.name)
        .sort((first, second) => variantPriority(first.value.printer_variant) - variantPriority(second.value.printer_variant))
      const selected = candidates
        .map((candidate) => ({ candidate, resolved: resolveProfile(candidate.value) }))
        .find(({ resolved }) => hasOrcaDimensions(resolved))
      if (!selected) continue
      const dimensions = printableAreaDimensions(selected.resolved.printable_area!)
      if (!dimensions) continue
      const model = stripBrand(modelEntry.name, brand)
      const id = printerPresetId('filament', brand, model)
      const profilePath = path.relative(sourceRoot, selected.candidate.path).replaceAll(path.sep, '/')
      const coverPath = path.join(vendorDirectory, `${modelEntry.name}_cover.png`)
      const sourceUrl = `${source.webRepository}/blob/${source.revision}/${encodePath(profilePath)}`
      const image = existsSync(coverPath)
        ? {
            src: `/printer-presets/orcaslicer/${id}.png`,
            sourceId: source.id,
            sourceUrl: `${source.webRepository}/blob/${source.revision}/${encodePath(
              path.join(source.catalogPath, path.basename(vendorFile, '.json'), `${modelEntry.name}_cover.png`).replaceAll(path.sep, '/'),
            )}`,
          }
        : undefined
      if (image) images.set(image.src, coverPath)
      presets.push({
        id,
        brand,
        model,
        printType: 'filament',
        widthMm: dimensions.widthMm,
        depthMm: dimensions.depthMm,
        heightMm: Number(selected.resolved.printable_height),
        filamentDiameterMm: 1.75,
        image,
        source: { id: source.id, url: sourceUrl },
      })
    }
  }
  return { presets, images }
}

export function parseUvtoolsCatalog(sourceRoot: string, source: CatalogSource, overrides: CatalogOverrides) {
  const profilesRoot = path.join(sourceRoot, source.catalogPath)
  const presets: GeneratedPrinterPreset[] = []
  for (const filename of readdirSync(profilesRoot)
    .filter((file) => file.endsWith('.ini'))
    .sort()) {
    const values = parseIni(readFileSync(path.join(profilesRoot, filename), 'utf8'))
    const widthMm = Number(values.display_width)
    const depthMm = Number(values.display_height)
    const heightMm = Number(values.max_print_height)
    if (![widthMm, depthMm, heightMm].every((value) => Number.isFinite(value) && value > 0)) continue
    const displayName = path.basename(filename, '.ini')
    const rawBrand = displayName.split(' ')[0] ?? 'Unknown'
    const brand = overrides.brandAliases[rawBrand] ?? rawBrand
    const model = stripBrand(displayName, brand)
    const sourcePath = path.join(source.catalogPath, filename).replaceAll(path.sep, '/')
    presets.push({
      id: printerPresetId('resin', brand, model),
      brand,
      model,
      printType: 'resin',
      widthMm,
      depthMm,
      heightMm,
      source: { id: source.id, url: `${source.webRepository}/blob/${source.revision}/${encodePath(sourcePath)}` },
    })
  }
  return { presets, images: new Map<string, string>() }
}

export function applyCatalogOverrides(presets: GeneratedPrinterPreset[], overrides: CatalogOverrides) {
  const excluded = new Set(overrides.excludeIds)
  return presets
    .filter((preset) => !excluded.has(preset.id))
    .map((preset) => ({ ...preset, ...overrides.patches[preset.id] }))
    .sort(
      (first, second) =>
        first.brand.localeCompare(second.brand) ||
        first.model.localeCompare(second.model) ||
        first.printType.localeCompare(second.printType),
    )
}

export function parseIni(contents: string) {
  return Object.fromEntries(
    contents
      .split(/\r?\n/)
      .map((line) => line.match(/^([^#=]+?)\s*=\s*(.*)$/))
      .filter((match): match is RegExpMatchArray => !!match)
      .map((match) => [match[1].trim(), match[2].trim()]),
  )
}

export function printableAreaDimensions(points: string[] | string) {
  const coordinates = (typeof points === 'string' ? points.split(',') : points)
    .map((point) => point.split('x').map(Number))
    .filter((point): point is [number, number] => point.length === 2 && point.every(Number.isFinite))
  if (coordinates.length < 3) return undefined
  const x = coordinates.map((point) => point[0])
  const y = coordinates.map((point) => point[1])
  const widthMm = Math.max(...x) - Math.min(...x)
  const depthMm = Math.max(...y) - Math.min(...y)
  return widthMm > 0 && depthMm > 0 ? { widthMm, depthMm } : undefined
}

export function normalizePrinterModel(value: string, brand = '') {
  const brandPattern = brand ? new RegExp(`^${escapeRegExp(brand)}\\s+`, 'i') : undefined
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/\([^)]*limited edition[^)]*\)/gi, '')
    .replace(brandPattern ?? /$^/, '')
    .toLocaleLowerCase()
    .replace(/\b(?:resin|3d|printers?|lcd|msla|sla|monochrome)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function parseBuildVolumeHtml(html: string) {
  const match = html.match(
    /Build Volume:\s*<\/h6>\s*<p[^>]*>\s*(\d+(?:\.\d+)?)\s*(?:×|x|\*)\s*(\d+(?:\.\d+)?)\s*(?:×|x|\*)\s*(\d+(?:\.\d+)?)\s*mm/i,
  )
  if (!match) return undefined
  const [, width, depth, height] = match.map(Number)
  return { widthMm: width, depthMm: depth, heightMm: height }
}

function readJsonFiles<T>(root: string, include: (file: string) => boolean) {
  const files: { path: string; value: T }[] = []
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory).sort()) {
      const file = path.join(directory, entry)
      if (statSync(file).isDirectory()) visit(file)
      else if (entry.endsWith('.json') && include(file)) files.push({ path: file, value: JSON.parse(readFileSync(file, 'utf8')) as T })
    }
  }
  visit(root)
  return files
}

function hasOrcaDimensions(profile: OrcaProfile) {
  return (
    (Array.isArray(profile.printable_area) ? profile.printable_area.length > 0 : !!profile.printable_area) &&
    Number(profile.printable_height) > 0
  )
}

function variantPriority(variant?: string) {
  if (variant === '0.4') return 0
  if (variant === '0.6') return 1
  if (variant === '0.2') return 2
  return 3
}

function stripBrand(name: string, brand: string) {
  const prefixes = [brand, brand.replaceAll(' ', ''), brand.split(' ')[0]]
  for (const prefix of prefixes) {
    if (name.toLocaleLowerCase().startsWith(`${prefix.toLocaleLowerCase()} `)) return name.slice(prefix.length).trim()
  }
  return name
}

export function printerPresetId(printType: GeneratedPrinterPreset['printType'], brand: string, model: string) {
  return `${printType}-${slug(`${brand}-${model}`)}`
}

function slug(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function encodePath(value: string) {
  return value.split('/').map(encodeURIComponent).join('/')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
