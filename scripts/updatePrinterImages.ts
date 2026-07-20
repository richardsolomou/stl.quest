import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import pRetry from 'p-retry'
import {
  normalizePrinterModel,
  parseBuildVolumeHtml,
  printerPresetId,
  type GeneratedPrinterPreset,
  type ManufacturerCatalogSource,
  type ManufacturerImage,
  type ManufacturerImageSource,
} from './printerCatalog'

type ShopifyProduct = {
  title: string
  handle: string
  product_type: string
  images?: { src: string }[]
}

type OpenResinPrinter = {
  name: string
  imageAssetPath?: string
}

const root = path.resolve(import.meta.dirname, '..')
const catalog = JSON.parse(readFileSync(path.join(root, 'printer-catalog/catalog.generated.json'), 'utf8')) as {
  presets: GeneratedPrinterPreset[]
}
const manifest = JSON.parse(readFileSync(path.join(root, 'printer-catalog/image-sources.json'), 'utf8')) as {
  sources: ManufacturerImageSource[]
}
const imagesRoot = path.join(root, 'public/printer-presets/manufacturer')
const outputPath = path.join(root, 'printer-catalog/manufacturer-images.json')
const manufacturerCatalogPath = path.join(root, 'printer-catalog/manufacturer-printers.json')
const checkedAt = new Date().toISOString().slice(0, 10)
const shopifyProducts = new Map<string, ShopifyProduct[]>()

const manufacturerPresets: GeneratedPrinterPreset[] = []
const manufacturerSources: ManufacturerCatalogSource[] = []
for (const source of manifest.sources) {
  if (source.kind !== 'shopify' || !source.catalog) continue
  manufacturerPresets.push(...(await synchronizeShopifyCatalog(source)))
  manufacturerSources.push({
    id: source.id,
    kind: 'resin',
    repository: source.storefrontUrl,
    revision: checkedAt,
    license: 'manufacturer product data',
  })
}
writeFileSync(manufacturerCatalogPath, `${JSON.stringify({ sources: manufacturerSources, presets: manufacturerPresets }, null, 2)}\n`)
const catalogPresets = [...catalog.presets, ...manufacturerPresets]

rmSync(imagesRoot, { recursive: true, force: true })
mkdirSync(imagesRoot, { recursive: true })

const images: ManufacturerImage[] = []
const claimedPresetIds = new Set<string>()
for (const source of manifest.sources) {
  const synchronized =
    source.kind === 'github'
      ? await synchronizeGithubSource(source, claimedPresetIds)
      : await synchronizeShopifySource(source, claimedPresetIds)
  images.push(...synchronized)
  for (const image of synchronized) claimedPresetIds.add(image.presetId)
}
images.sort((first, second) => first.presetId.localeCompare(second.presetId))
writeFileSync(outputPath, `${JSON.stringify({ images }, null, 2)}\n`)
console.log(`Synchronized ${images.length} manufacturer printer images.`)

async function synchronizeShopifySource(source: Extract<ManufacturerImageSource, { kind: 'shopify' }>, existingPresetIds: Set<string>) {
  const products = (await loadShopifyProducts(source))
    .filter((product) => source.productTypes.includes(product.product_type) && product.images?.[0]?.src)
    .sort((first, second) => source.productTypes.indexOf(first.product_type) - source.productTypes.indexOf(second.product_type))
  const productsByModel = new Map<string, ShopifyProduct>()
  for (const product of products) {
    const normalizedTitle = normalizePrinterModel(product.title, source.brand)
    const model = source.titleAliases?.[normalizedTitle]
    const key = normalizePrinterModel(model ?? normalizedTitle)
    if (!productsByModel.has(key)) productsByModel.set(key, product)
  }

  const matched: ManufacturerImage[] = []
  for (const preset of catalogPresets.filter((candidate) => candidate.printType === 'resin' && candidate.brand === source.brand)) {
    if (existingPresetIds.has(preset.id)) continue
    const product = productsByModel.get(normalizePrinterModel(preset.model))
    const sourceUrl = product?.images?.[0]?.src
    if (!product || !sourceUrl) continue
    const extension = imageExtension(sourceUrl)
    const src = `/printer-presets/manufacturer/${preset.id}.${extension}`
    const imageResponse = await fetchWithRetry(sourceUrl)
    if (!imageResponse.ok) throw new Error(`${source.id} image for ${preset.id} returned ${imageResponse.status}`)
    writeFileSync(path.join(root, 'public', src), Buffer.from(await imageResponse.arrayBuffer()))
    matched.push({
      presetId: preset.id,
      sourceId: source.id,
      sourcePageUrl: `${source.storefrontUrl}/products/${product.handle}`,
      sourceUrl,
      src,
      checkedAt,
    })
  }
  return matched
}

async function synchronizeShopifyCatalog(source: Extract<ManufacturerImageSource, { kind: 'shopify' }>) {
  if (!source.catalog) return []
  const excluded = source.catalog.excludeTitlePattern ? new RegExp(source.catalog.excludeTitlePattern, 'i') : undefined
  const presets: GeneratedPrinterPreset[] = []
  for (const product of await loadShopifyProducts(source)) {
    if (!source.productTypes.includes(product.product_type) || excluded?.test(product.title)) continue
    const sourcePageUrl = `${source.storefrontUrl}/products/${product.handle}`
    const response = await fetchWithRetry(sourcePageUrl)
    if (!response.ok) throw new Error(`${source.id} product page ${product.handle} returned ${response.status}`)
    const dimensions = parseBuildVolumeHtml(await response.text())
    if (!dimensions) throw new Error(`${source.id} product ${product.title} has no parseable build volume`)
    const normalizedTitle = normalizePrinterModel(product.title, source.brand)
    const model = source.titleAliases?.[normalizedTitle] ?? storefrontModelName(product.title, source.brand)
    presets.push({
      id: printerPresetId('resin', source.brand, model),
      brand: source.brand,
      model,
      printType: 'resin',
      ...dimensions,
      source: { id: source.id, url: sourcePageUrl },
    })
  }
  return presets
}

async function loadShopifyProducts(source: Extract<ManufacturerImageSource, { kind: 'shopify' }>) {
  const cached = shopifyProducts.get(source.id)
  if (cached) return cached
  const response = await fetchWithRetry(source.feedUrl)
  if (!response.ok) throw new Error(`${source.id} product feed returned ${response.status}`)
  const feed = (await response.json()) as { products?: ShopifyProduct[] }
  if (!feed.products) throw new Error(`${source.id} product feed has no products`)
  shopifyProducts.set(source.id, feed.products)
  return feed.products
}

async function synchronizeGithubSource(source: Extract<ManufacturerImageSource, { kind: 'github' }>, existingPresetIds: Set<string>) {
  const printersByModel = new Map<string, { printer: OpenResinPrinter; definitionPath: string }>()
  for (const definitionPath of source.definitionPaths) {
    const response = await fetchWithRetry(rawGithubUrl(source, definitionPath))
    if (!response.ok) throw new Error(`${source.id} definition ${definitionPath} returned ${response.status}`)
    const printers = (await response.json()) as OpenResinPrinter[]
    for (const printer of printers) {
      if (!printer.imageAssetPath) continue
      const normalizedTitle = normalizePrinterModel(printer.name, source.brand)
      const model = source.titleAliases?.[normalizedTitle]
      const key = normalizePrinterModel(model ?? normalizedTitle)
      if (!printersByModel.has(key)) printersByModel.set(key, { printer, definitionPath })
    }
  }

  const licenseResponse = await fetchWithRetry(rawGithubUrl(source, source.licensePath))
  if (!licenseResponse.ok) throw new Error(`${source.id} license returned ${licenseResponse.status}`)
  writeFileSync(path.join(root, source.licenseOutput), await licenseResponse.text())

  const matched: ManufacturerImage[] = []
  for (const preset of catalog.presets.filter((candidate) => candidate.printType === 'resin' && candidate.brand === source.brand)) {
    if (existingPresetIds.has(preset.id)) continue
    const match = printersByModel.get(normalizePrinterModel(preset.model))
    if (!match?.printer.imageAssetPath) continue
    const imagePath = path.posix.normalize(path.posix.join(path.posix.dirname(match.definitionPath), match.printer.imageAssetPath))
    const sourceUrl = rawGithubUrl(source, imagePath)
    const extension = imageExtension(sourceUrl)
    const src = `/printer-presets/manufacturer/${preset.id}.${extension}`
    const imageResponse = await fetchWithRetry(sourceUrl)
    if (!imageResponse.ok) throw new Error(`${source.id} image for ${preset.id} returned ${imageResponse.status}`)
    writeFileSync(path.join(root, 'public', src), Buffer.from(await imageResponse.arrayBuffer()))
    matched.push({
      presetId: preset.id,
      sourceId: source.id,
      sourcePageUrl: `https://github.com/${source.repository}/blob/${source.revision}/${imagePath}`,
      sourceUrl,
      src,
      checkedAt,
    })
  }
  return matched
}

function rawGithubUrl(source: Extract<ManufacturerImageSource, { kind: 'github' }>, filePath: string) {
  return `https://raw.githubusercontent.com/${source.repository}/${source.revision}/${filePath}`
}

function fetchWithRetry(url: string) {
  return pRetry(
    async () => {
      const response = await fetch(url)
      if (response.status === 429 || response.status >= 500) throw new Error(`${url} returned ${response.status}`)
      return response
    },
    { retries: 2, minTimeout: 500 },
  )
}

function storefrontModelName(title: string, brand: string) {
  return title
    .replace(new RegExp(`^${brand}\\s+`, 'i'), '')
    .replace(/\s+3D Printer$/i, '')
    .trim()
}

function imageExtension(url: string) {
  const extension = path.extname(new URL(url).pathname).slice(1).toLocaleLowerCase()
  if (['jpg', 'jpeg', 'png', 'webp'].includes(extension)) return extension
  throw new Error(`Unsupported manufacturer image extension: ${url}`)
}
