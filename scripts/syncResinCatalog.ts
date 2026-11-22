import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkCatalogImages } from './catalogImages'
import { assertRevisions, checkoutSource, writeSourceLicense } from './catalogSources'
import { fetchWithRetry } from './catalogFetch'
import {
  FORMLABS_SOURCE_ID,
  formlabsResinPreset,
  mergeResinPresets,
  parseFormlabsMaterials,
  parseFormlabsSafetyDataSheets,
  parsePrusaSlaMaterials,
  parseSafetyDataSheetDensity,
  selectFormlabsResins,
  type GeneratedResinPreset,
  type ResinCatalogSource,
} from './resinCatalog'

type Source = ResinCatalogSource & {
  repository: string
  branch: string
  license: string
  licensePath: string
  licenseOutput: string
}

type CatalogSource = { id: string; repository: string; revision: string; license: string }
type CuratedCatalog = { sources: CatalogSource[]; presets: GeneratedResinPreset[] }

const root = path.resolve(import.meta.dirname, '..')
const sourcesPath = path.join(root, 'catalogs/resins/sources.json')
const manufacturerPath = path.join(root, 'catalogs/resins/manufacturer-resins.json')
const formlabsPath = path.join(root, 'catalogs/resins/formlabs-resins.json')
const outputPath = path.join(root, 'catalogs/resins/catalog.generated.json')
const formlabsMaterialsUrl = 'https://formlabs.com/global/products/materials/'
const formlabsDataSheetsUrl = 'https://formlabs.com/global/materials/data-sheets/'
const update = process.argv.includes('--update')
const check = process.argv.includes('--check')
const manifest = JSON.parse(readFileSync(sourcesPath, 'utf8')) as { sources: Source[] }
const manufacturer = JSON.parse(readFileSync(manufacturerPath, 'utf8')) as CuratedCatalog
let formlabs = JSON.parse(readFileSync(formlabsPath, 'utf8')) as CuratedCatalog

if (check) validateCommittedCatalog()
else await synchronizeCatalog()

async function synchronizeCatalog() {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'stlquest-resin-catalog-'))
  try {
    if (update) formlabs = await fetchFormlabsResins(temporaryRoot)
    const generated: GeneratedResinPreset[] = []
    for (const source of manifest.sources) {
      const checkout = checkoutSource(temporaryRoot, source, update)
      generated.push(...parsePrusaSlaMaterials(readFileSync(path.join(checkout, source.catalogPath), 'utf8'), source))
      writeSourceLicense(root, checkout, source)
    }
    const sources = [
      ...manifest.sources.map(({ id, webRepository: repository, revision, license }) => ({ id, repository, revision, license })),
      ...manufacturer.sources,
      ...formlabs.sources,
    ]
    const presets = mergeResinPresets(generated, [...manufacturer.presets, ...formlabs.presets])
    validateCatalog(presets, sources)
    writeFileSync(outputPath, `${JSON.stringify({ sources, presets }, null, 2)}\n`)
    if (update) {
      writeFileSync(sourcesPath, `${JSON.stringify({ sources: manifest.sources }, null, 2)}\n`)
      writeFileSync(formlabsPath, `${JSON.stringify(formlabs, null, 2)}\n`)
    }
    console.log(`Synchronized ${presets.length} resin presets.`)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

/** Lists current Formlabs SLA resins and reads each density from its US safety data sheet with Poppler's `pdftotext`. */
async function fetchFormlabsResins(temporaryRoot: string): Promise<CuratedCatalog> {
  const materials = parseFormlabsMaterials(await fetchText(formlabsMaterialsUrl), formlabsMaterialsUrl)
  const sheets = parseFormlabsSafetyDataSheets(await fetchText(formlabsDataSheetsUrl))
  const { resins, skipped } = selectFormlabsResins(materials, sheets)
  const presets: GeneratedResinPreset[] = []
  const pdf = path.join(temporaryRoot, 'safety-data-sheet.pdf')
  for (const { material, sheetUrl } of resins) {
    writeFileSync(pdf, Buffer.from(await (await fetchOk(sheetUrl)).arrayBuffer()))
    const density = parseSafetyDataSheetDensity(execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', pdf, '-'], { encoding: 'utf8' }))
    if (density) presets.push(formlabsResinPreset(material, sheetUrl, density))
    else skipped.push({ name: material.name, reason: 'no density in its safety data sheet' })
  }
  for (const { name, reason } of skipped) console.log(`Skipped Formlabs ${name}: ${reason}.`)
  const source = {
    id: FORMLABS_SOURCE_ID,
    repository: formlabsMaterialsUrl,
    revision: new Date().toISOString().slice(0, 10),
    license: 'manufacturer product data',
  }
  return { sources: [source], presets: presets.sort((first, second) => first.name.localeCompare(second.name)) }
}

async function fetchText(url: string) {
  return (await fetchOk(url)).text()
}

async function fetchOk(url: string) {
  const response = await fetchWithRetry(url)
  if (!response.ok) throw new Error(`${url} returned ${response.status}`)
  return response
}

function validateCommittedCatalog() {
  if (!existsSync(outputPath)) throw new Error('catalogs/resins/catalog.generated.json is missing; run pnpm catalog:sync')
  const catalog = JSON.parse(readFileSync(outputPath, 'utf8')) as { sources: CatalogSource[]; presets: GeneratedResinPreset[] }
  assertRevisions(catalog.sources, [...manifest.sources, ...manufacturer.sources, ...formlabs.sources], 'resin catalog')
  for (const source of manifest.sources) {
    if (!existsSync(path.join(root, source.licenseOutput))) throw new Error(`Missing ${source.id} license file`)
  }
  validateCatalog(catalog.presets, catalog.sources)
  const images = checkCatalogImages({
    imagesPath: path.join(root, 'catalogs/resins/images.json'),
    publicRoot: path.join(root, 'public'),
    directory: 'resin-presets',
    presetIds: new Set(catalog.presets.map((preset) => preset.id)),
  })
  console.log(`Validated ${catalog.presets.length} resin presets and ${images} images.`)
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
