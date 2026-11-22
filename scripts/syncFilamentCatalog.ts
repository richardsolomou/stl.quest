import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assertRevisions, checkoutSource, writeSourceLicense } from './catalogSources'
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
    for (const source of manifest.sources) {
      const checkout = checkoutSource(temporaryRoot, source, update)
      parsed.push(...parseSpoolmanFilaments(jsonFiles(checkout, path.join(checkout, source.catalogPath)), source))
      writeSourceLicense(root, checkout, source)
    }
    const presets = applyFilamentPatches(parsed, overrides.patches)
    const sources = manifest.sources.map(({ id, webRepository: repository, revision, license }) => ({ id, repository, revision, license }))
    validateCatalog(presets, sources)
    writeFileSync(outputPath, `${JSON.stringify({ sources, presets }, null, 2)}\n`)
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

function jsonFiles(checkout: string, directory: string) {
  return readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.json'))
    .map((file) => ({
      path: path.relative(checkout, path.join(directory, file)),
      contents: readFileSync(path.join(directory, file), 'utf8'),
    }))
}
