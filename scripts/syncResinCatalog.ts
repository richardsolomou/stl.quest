import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assertRevisions, checkoutSource, writeSourceLicense } from './catalogSources'
import { mergeResinPresets, parsePrusaSlaMaterials, type GeneratedResinPreset, type ResinCatalogSource } from './resinCatalog'

type Source = ResinCatalogSource & {
  repository: string
  branch: string
  license: string
  licensePath: string
  licenseOutput: string
}

type CatalogSource = { id: string; repository: string; revision: string; license: string }

const root = path.resolve(import.meta.dirname, '..')
const sourcesPath = path.join(root, 'catalogs/resins/sources.json')
const manufacturerPath = path.join(root, 'catalogs/resins/manufacturer-resins.json')
const outputPath = path.join(root, 'catalogs/resins/catalog.generated.json')
const update = process.argv.includes('--update')
const check = process.argv.includes('--check')
const manifest = JSON.parse(readFileSync(sourcesPath, 'utf8')) as { sources: Source[] }
const manufacturer = JSON.parse(readFileSync(manufacturerPath, 'utf8')) as {
  sources: CatalogSource[]
  presets: GeneratedResinPreset[]
}

if (check) validateCommittedCatalog()
else synchronizeCatalog()

function synchronizeCatalog() {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'stlquest-resin-catalog-'))
  try {
    const generated: GeneratedResinPreset[] = []
    for (const source of manifest.sources) {
      const checkout = checkoutSource(temporaryRoot, source, update)
      generated.push(...parsePrusaSlaMaterials(readFileSync(path.join(checkout, source.catalogPath), 'utf8'), source))
      writeSourceLicense(root, checkout, source)
    }
    const sources = [
      ...manifest.sources.map(({ id, webRepository: repository, revision, license }) => ({ id, repository, revision, license })),
      ...manufacturer.sources,
    ]
    const presets = mergeResinPresets(generated, manufacturer.presets)
    validateCatalog(presets, sources)
    writeFileSync(outputPath, `${JSON.stringify({ sources, presets }, null, 2)}\n`)
    if (update) writeFileSync(sourcesPath, `${JSON.stringify({ sources: manifest.sources }, null, 2)}\n`)
    console.log(`Synchronized ${presets.length} resin presets.`)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

function validateCommittedCatalog() {
  if (!existsSync(outputPath)) throw new Error('catalogs/resins/catalog.generated.json is missing; run pnpm catalog:sync')
  const catalog = JSON.parse(readFileSync(outputPath, 'utf8')) as { sources: CatalogSource[]; presets: GeneratedResinPreset[] }
  assertRevisions(catalog.sources, [...manifest.sources, ...manufacturer.sources], 'resin catalog')
  for (const source of manifest.sources) {
    if (!existsSync(path.join(root, source.licenseOutput))) throw new Error(`Missing ${source.id} license file`)
  }
  validateCatalog(catalog.presets, catalog.sources)
  console.log(`Validated ${catalog.presets.length} resin presets.`)
}

function validateCatalog(presets: GeneratedResinPreset[], sources: CatalogSource[]) {
  const ids = new Set<string>()
  const sourceIds = new Set(sources.map((source) => source.id))
  for (const preset of presets) {
    if (ids.has(preset.id)) throw new Error(`Duplicate resin preset ID ${preset.id}`)
    ids.add(preset.id)
    if (!sourceIds.has(preset.source.id)) throw new Error(`Unknown source ${preset.source.id} for ${preset.id}`)
    if (preset.densityGramsPerMl !== undefined && (!Number.isFinite(preset.densityGramsPerMl) || preset.densityGramsPerMl <= 0)) {
      throw new Error(`Invalid density for ${preset.id}`)
    }
  }
  if (presets.length < 75) throw new Error(`Resin catalog unexpectedly small: ${presets.length} presets`)
}
