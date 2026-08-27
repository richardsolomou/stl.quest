import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  mergeElectricityPrices,
  parseEcbUsdPerEur,
  parseEurostatElectricityPrices,
  parseIeaElectricityPrices,
  type ElectricityCatalogSource,
  type ElectricityPricePreset,
} from './electricityCatalog'

const root = path.resolve(import.meta.dirname, '..')
const sourcesPath = path.join(root, 'catalogs/electricity/sources.json')
const outputPath = path.join(root, 'catalogs/electricity/catalog.generated.json')
const check = process.argv.includes('--check')
const sources = (JSON.parse(readFileSync(sourcesPath, 'utf8')) as { sources: ElectricityCatalogSource[] }).sources
const eurostatSource = requiredSource('eurostat-nrg-pc-204')
const ieaSource = requiredSource('iea-end-use-prices')
const ecbSource = requiredSource('ecb-exr-usd-eur')

if (check) validateCommittedCatalog()
else await synchronizeCatalog()

async function synchronizeCatalog() {
  const [eurostatResponse, ieaResponse, ecbResponse] = await Promise.all(sources.map(fetchSource))
  const usdPerEur = parseEcbUsdPerEur(await ecbResponse.text(), ecbSource.period)
  const presets = mergeElectricityPrices(
    parseEurostatElectricityPrices(await eurostatResponse.json(), eurostatSource),
    parseIeaElectricityPrices(await ieaResponse.json(), ieaSource, usdPerEur),
  )
  validateCatalog(presets)
  writeFileSync(outputPath, `${JSON.stringify({ sources, presets }, null, 2)}\n`)
  console.log(`Synchronized electricity prices for ${presets.length} countries.`)
}

function validateCommittedCatalog() {
  if (!existsSync(outputPath)) throw new Error('catalogs/electricity/catalog.generated.json is missing; run pnpm catalog:sync')
  const catalog = JSON.parse(readFileSync(outputPath, 'utf8')) as {
    sources: ElectricityCatalogSource[]
    presets: ElectricityPricePreset[]
  }
  if (JSON.stringify(catalog.sources) !== JSON.stringify(sources))
    throw new Error('Generated electricity catalog sources do not match sources.json')
  validateCatalog(catalog.presets)
  console.log(`Validated electricity prices for ${catalog.presets.length} countries.`)
}

function validateCatalog(presets: ElectricityPricePreset[]) {
  if (presets.length < 50) throw new Error(`Electricity catalog unexpectedly small: ${presets.length} presets`)
  if (new Set(presets.map((preset) => preset.countryCode)).size !== presets.length) throw new Error('Duplicate electricity country code')
  const sourcePeriods = new Map(sources.map((source) => [source.id, source.period]))
  if (presets.some((preset) => preset.period !== sourcePeriods.get(preset.source.id) || preset.eurPerKwh <= 0)) {
    throw new Error('Invalid electricity preset')
  }
}

function requiredSource(id: string) {
  const source = sources.find((candidate) => candidate.id === id)
  if (!source) throw new Error(`Missing electricity source: ${id}`)
  return source
}

async function fetchSource(source: ElectricityCatalogSource) {
  const response = await fetch(source.url, { headers: { 'user-agent': 'STL Quest electricity catalog sync' } })
  if (!response.ok) throw new Error(`${source.id} returned ${response.status}`)
  return response
}
