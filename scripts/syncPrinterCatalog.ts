import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  applyCatalogOverrides,
  mergePrinterPresets,
  parseOrcaCatalog,
  parseUvtoolsCatalog,
  type CatalogOverrides,
  type CatalogSource,
  type GeneratedPrinterPreset,
  type ManufacturerCatalogSource,
  type ManufacturerImage,
} from './printerCatalog'

const root = path.resolve(import.meta.dirname, '..')
const sourcesPath = path.join(root, 'printer-catalog/sources.json')
const overridesPath = path.join(root, 'printer-catalog/overrides.json')
const manufacturerImagesPath = path.join(root, 'printer-catalog/manufacturer-images.json')
const manufacturerCatalogPath = path.join(root, 'printer-catalog/manufacturer-printers.json')
const outputPath = path.join(root, 'printer-catalog/catalog.generated.json')
const imagesRoot = path.join(root, 'public/printer-presets')
const orcaImagesRoot = path.join(imagesRoot, 'orcaslicer')
const update = process.argv.includes('--update')
const check = process.argv.includes('--check')

const manifest = JSON.parse(readFileSync(sourcesPath, 'utf8')) as { sources: CatalogSource[] }
const overrides = JSON.parse(readFileSync(overridesPath, 'utf8')) as CatalogOverrides
const manufacturerImages = JSON.parse(readFileSync(manufacturerImagesPath, 'utf8')) as { images: ManufacturerImage[] }
const manufacturerCatalog = JSON.parse(readFileSync(manufacturerCatalogPath, 'utf8')) as {
  sources: ManufacturerCatalogSource[]
  presets: GeneratedPrinterPreset[]
}

if (check) {
  validateCommittedCatalog(manifest.sources)
} else {
  synchronizeCatalog(manifest.sources)
}

function synchronizeCatalog(sources: CatalogSource[]) {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'printhub-printer-catalog-'))
  try {
    const presets: GeneratedPrinterPreset[] = []
    const images = new Map<string, string>()
    for (const source of sources) {
      const checkout = checkoutSource(temporaryRoot, source)
      if (update) source.revision = git(checkout, 'rev-parse', 'HEAD').trim()
      const parsed =
        source.kind === 'filament' ? parseOrcaCatalog(checkout, source, overrides) : parseUvtoolsCatalog(checkout, source, overrides)
      presets.push(...parsed.presets)
      for (const [destination, sourceImage] of parsed.images) images.set(destination, sourceImage)
      const license = git(checkout, 'show', `HEAD:${source.licensePath}`)
      const licenseOutput = path.join(root, source.licenseOutput)
      mkdirSync(path.dirname(licenseOutput), { recursive: true })
      writeFileSync(licenseOutput, license)
    }

    const mergedPresets = mergePrinterPresets(presets, manufacturerCatalog.presets)

    const catalogSources = [
      ...sources.map(({ id, kind, webRepository, revision, license }) => ({
        id,
        kind,
        repository: webRepository,
        revision,
        license,
      })),
      ...manufacturerCatalog.sources,
    ]
    const catalog = {
      sources: catalogSources,
      presets: applyManufacturerImages(applyCatalogOverrides(mergedPresets, overrides)),
    }
    validateCatalog(catalog.presets, catalogSources)
    writeFileSync(outputPath, `${JSON.stringify(catalog, null, 2)}\n`)
    rmSync(orcaImagesRoot, { recursive: true, force: true })
    const referencedImages = new Set(catalog.presets.flatMap((preset) => (preset.image ? [preset.image.src] : [])))
    for (const [destination, sourceImage] of images) {
      if (!referencedImages.has(destination)) continue
      const output = path.join(root, 'public', destination)
      mkdirSync(path.dirname(output), { recursive: true })
      copyFileSync(sourceImage, output)
    }
    if (update) writeFileSync(sourcesPath, `${JSON.stringify({ sources }, null, 2)}\n`)
    console.log(`Synchronized ${catalog.presets.length} printers with ${referencedImages.size} local images.`)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

function applyManufacturerImages(presets: GeneratedPrinterPreset[]) {
  const imagesByPreset = new Map(manufacturerImages.images.map((image) => [image.presetId, image]))
  return presets.map((preset) => {
    const image = imagesByPreset.get(preset.id)
    return image ? { ...preset, image: { src: image.src, sourceId: image.sourceId, sourceUrl: image.sourcePageUrl } } : preset
  })
}

function checkoutSource(temporaryRoot: string, source: CatalogSource) {
  const checkout = path.join(temporaryRoot, source.id)
  mkdirSync(checkout)
  git(checkout, 'init', '--quiet')
  git(checkout, 'remote', 'add', 'origin', source.repository)
  git(checkout, 'sparse-checkout', 'init', '--cone')
  git(checkout, 'sparse-checkout', 'set', source.catalogPath)
  git(checkout, 'fetch', '--quiet', '--depth', '1', 'origin', update ? source.branch : source.revision)
  git(checkout, 'checkout', '--quiet', 'FETCH_HEAD')
  return checkout
}

function validateCommittedCatalog(sources: CatalogSource[]) {
  if (!existsSync(outputPath)) throw new Error('printer-catalog/catalog.generated.json is missing; run pnpm catalog:sync')
  const catalog = JSON.parse(readFileSync(outputPath, 'utf8')) as {
    sources: { id: string; revision: string }[]
    presets: GeneratedPrinterPreset[]
  }
  for (const source of sources) {
    const generatedSource = catalog.sources.find((candidate) => candidate.id === source.id)
    if (generatedSource?.revision !== source.revision) throw new Error(`${source.id} revision does not match the generated catalog`)
    if (!existsSync(path.join(root, source.licenseOutput))) throw new Error(`Missing ${source.id} license file`)
  }
  for (const source of manufacturerCatalog.sources) {
    const generatedSource = catalog.sources.find((candidate) => candidate.id === source.id)
    if (generatedSource?.revision !== source.revision) throw new Error(`${source.id} revision does not match the generated catalog`)
  }
  validateCatalog(catalog.presets, [...sources, ...manufacturerCatalog.sources])
  const referencedImages = new Set(catalog.presets.flatMap((preset) => (preset.image ? [preset.image.src] : [])))
  for (const image of referencedImages) {
    if (!existsSync(path.join(root, 'public', image))) throw new Error(`Missing generated printer image ${image}`)
  }
  const committedImages = existsSync(imagesRoot)
    ? readdirRecursive(imagesRoot).map((file) => `/${path.relative(path.join(root, 'public'), file)}`)
    : []
  for (const image of committedImages) {
    if (!referencedImages.has(image)) throw new Error(`Unreferenced generated printer image ${image}`)
  }
  console.log(`Validated ${catalog.presets.length} printers with ${referencedImages.size} local images.`)
}

function validateCatalog(presets: GeneratedPrinterPreset[], sources: readonly { id: string }[]) {
  const sourceIds = new Set(sources.map((source) => source.id))
  const ids = new Set<string>()
  for (const preset of presets) {
    if (ids.has(preset.id)) throw new Error(`Duplicate printer preset ID ${preset.id}`)
    ids.add(preset.id)
    if (!sourceIds.has(preset.source.id)) throw new Error(`Unknown source ${preset.source.id} for ${preset.id}`)
    if (![preset.widthMm, preset.depthMm, preset.heightMm].every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error(`Invalid build dimensions for ${preset.id}`)
    }
  }
  const filament = presets.filter((preset) => preset.printType === 'filament').length
  const resin = presets.filter((preset) => preset.printType === 'resin').length
  if (filament < 300 || resin < 100) throw new Error(`Catalog unexpectedly small: ${filament} filament, ${resin} resin`)
}

function readdirRecursive(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? readdirRecursive(file) : [file]
  })
}

function git(directory: string, ...arguments_: string[]) {
  return execFileSync('git', ['-C', directory, ...arguments_], { encoding: 'utf8' })
}
