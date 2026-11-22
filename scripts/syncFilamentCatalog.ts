import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assertRevisions, checkoutSource, writeSourceLicense } from './catalogSources'
import type { SpoolmanCatalogue } from '../src/core/spoolman'
import {
  applyFilamentPatches,
  parseSpoolmanFilaments,
  type FilamentCatalogSource,
  type FilamentPatches,
  type GeneratedFilamentPreset,
} from './filamentCatalog'

type Source = FilamentCatalogSource & {
  repository: string
  branch: string
  license: string
  licensePath: string
  licenseOutput: string
}

type CatalogSource = { id: string; repository: string; revision: string; license: string }

const root = path.resolve(import.meta.dirname, '..')
const sourcesPath = path.join(root, 'catalogs/filaments/sources.json')
const outputPath = path.join(root, 'catalogs/filaments/catalog.generated.json')
const overridesPath = path.join(root, 'catalogs/filaments/overrides.json')
const spoolmanPath = path.join(root, 'catalogs/filaments/spoolman.generated.json')
const update = process.argv.includes('--update')
const check = process.argv.includes('--check')
const manifest = JSON.parse(readFileSync(sourcesPath, 'utf8')) as { sources: Source[] }
const overrides = JSON.parse(readFileSync(overridesPath, 'utf8')) as { patches: FilamentPatches }

if (check) validateCommittedCatalog()
else synchronizeCatalog()

function synchronizeCatalog() {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'stlquest-filament-catalog-'))
  try {
    const parsed: GeneratedFilamentPreset[] = []
    const spoolman: SpoolmanCatalogue = { colours: {}, presets: {} }
    for (const source of manifest.sources) {
      const checkout = checkoutSource(temporaryRoot, source, update)
      const read = parseSpoolmanFilaments(jsonFiles(checkout, path.join(checkout, source.catalogPath)), source)
      parsed.push(...read.presets)
      Object.assign(spoolman.colours, read.spoolman.colours)
      Object.assign(spoolman.presets, read.spoolman.presets)
      writeSourceLicense(root, checkout, source)
    }
    const presets = applyFilamentPatches(parsed, overrides.patches)
    const sources = manifest.sources.map(({ id, webRepository: repository, revision, license }) => ({ id, repository, revision, license }))
    validateCatalog(presets, sources)
    validateSpoolman(spoolman, presets)
    writeFileSync(outputPath, `${JSON.stringify({ sources, presets }, null, 2)}\n`)
    writeFileSync(spoolmanPath, `${formatPairs(JSON.stringify(spoolman, null, 2))}\n`)
    if (update) writeFileSync(sourcesPath, `${JSON.stringify({ sources: manifest.sources }, null, 2)}\n`)
    console.log(`Synchronized ${presets.length} filament presets.`)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

function validateCommittedCatalog() {
  if (!existsSync(outputPath)) throw new Error('catalogs/filaments/catalog.generated.json is missing; run pnpm catalog:sync')
  const catalog = JSON.parse(readFileSync(outputPath, 'utf8')) as { sources: CatalogSource[]; presets: GeneratedFilamentPreset[] }
  assertRevisions(catalog.sources, manifest.sources, 'filament catalog')
  for (const source of manifest.sources) {
    if (!existsSync(path.join(root, source.licenseOutput))) throw new Error(`Missing ${source.id} license file`)
  }
  validateCatalog(catalog.presets, catalog.sources)
  if (!existsSync(spoolmanPath)) throw new Error('catalogs/filaments/spoolman.generated.json is missing; run pnpm catalog:sync')
  validateSpoolman(JSON.parse(readFileSync(spoolmanPath, 'utf8')) as SpoolmanCatalogue, catalog.presets)
  console.log(`Validated ${catalog.presets.length} filament presets.`)
}

function validateCatalog(presets: GeneratedFilamentPreset[], sources: CatalogSource[]) {
  const ids = new Set<string>()
  const sourceIds = new Set(sources.map((source) => source.id))
  for (const preset of presets) {
    if (ids.has(preset.id)) throw new Error(`Duplicate filament preset ID ${preset.id}`)
    ids.add(preset.id)
    if (!sourceIds.has(preset.source.id)) throw new Error(`Unknown source ${preset.source.id} for ${preset.id}`)
  }
  if (presets.length < 300) throw new Error(`Filament catalog unexpectedly small: ${presets.length} presets`)
}

/** Keeps each pair on one line, as the formatter does. */
function formatPairs(json: string) {
  return json.replace(/\[\n\s+("[^"\n]*"),\n\s+("[^"\n]*")\n\s+\]/g, '[$1, $2]')
}

function validateSpoolman(spoolman: SpoolmanCatalogue, presets: GeneratedFilamentPreset[]) {
  const colours = new Map(presets.map((preset) => [preset.id, new Set(preset.colors?.map((color) => color.names.en))]))
  for (const [stem, [presetId, colour]] of Object.entries(spoolman.colours)) {
    if (!colours.get(presetId)?.has(colour)) throw new Error(`SpoolmanDB ID ${stem} names unknown colour ${presetId} ${colour}`)
  }
  if (Object.keys(spoolman.colours).length < 1_000) throw new Error('Spoolman matching catalog unexpectedly small')
}

function jsonFiles(checkout: string, directory: string) {
  return readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.json'))
    .map((file) => ({
      path: path.relative(checkout, path.join(directory, file)),
      contents: readFileSync(path.join(directory, file), 'utf8'),
    }))
}
