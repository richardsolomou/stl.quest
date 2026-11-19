import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import pRetry from 'p-retry'
import {
  definitionPathsFromTree,
  extractProductImageUrl,
  formlabsPresetId,
  normalizePrinterModel,
  openResinBuildVolume,
  parseBuildVolumeHtml,
  parseFormlabsProductImages,
  parseFormlabsTechSpecs,
  printerPresetId,
  type GeneratedPrinterPreset,
  type ManufacturerCatalogSource,
  type ManufacturerImage,
  type ManufacturerImageSource,
  type OpenResinPrinter,
} from './printerCatalog'

type ShopifyProduct = {
  title: string
  handle: string
  product_type: string
  images?: { src: string }[]
}

const root = path.resolve(import.meta.dirname, '..')
const catalog = JSON.parse(readFileSync(path.join(root, 'catalogs/printers/catalog.generated.json'), 'utf8')) as {
  presets: GeneratedPrinterPreset[]
}
const manifest = JSON.parse(readFileSync(path.join(root, 'catalogs/printers/image-sources.json'), 'utf8')) as {
  sources: ManufacturerImageSource[]
}
const manifestPath = path.join(root, 'catalogs/printers/image-sources.json')
const imagesRoot = path.join(root, 'public/printer-presets/manufacturer')
const outputPath = path.join(root, 'catalogs/printers/manufacturer-images.json')
const manufacturerCatalogPath = path.join(root, 'catalogs/printers/manufacturer-printers.json')
const previousManufacturerCatalog = JSON.parse(readFileSync(manufacturerCatalogPath, 'utf8')) as {
  sources: ManufacturerCatalogSource[]
  presets: GeneratedPrinterPreset[]
}
const previousPresetsByUrl = new Map(previousManufacturerCatalog.presets.map((preset) => [preset.source.url, preset]))
const previousManufacturerSourceIds = new Set(previousManufacturerCatalog.sources.map((source) => source.id))
const communityPresets = catalog.presets.filter((preset) => !previousManufacturerSourceIds.has(preset.source.id))
const checkedAt = new Date().toISOString().slice(0, 10)
const update = process.argv.includes('--update')
const lastRequestAt = new Map<string, number>()
const shopifyProducts = new Map<string, ShopifyProduct[]>()
const openResinPrinters = new Map<string, { printer: OpenResinPrinter; definitionPath: string }[]>()

if (update) {
  for (const source of manifest.sources) {
    if (source.kind === 'github' || source.kind === 'open-resin') source.revision = await latestGithubRevision(source)
  }
}

const manufacturerPresets: GeneratedPrinterPreset[] = []
const manufacturerSources: ManufacturerCatalogSource[] = []
const claimedCatalogPresetIds = new Set(communityPresets.map((preset) => preset.id))
for (const source of manifest.sources) {
  if (!source.catalog || source.kind === 'github' || source.kind === 'webpage') continue
  const synchronized =
    source.kind === 'open-resin'
      ? await synchronizeGithubCatalog(source)
      : source.kind === 'formlabs'
        ? await synchronizeFormlabsCatalog(source)
        : await synchronizeShopifyCatalog(source)
  for (const preset of synchronized) {
    if (claimedCatalogPresetIds.has(preset.id)) continue
    manufacturerPresets.push(preset)
    claimedCatalogPresetIds.add(preset.id)
  }
  manufacturerSources.push({
    id: source.id,
    kind: 'resin',
    repository:
      source.kind === 'open-resin'
        ? `https://github.com/${source.repository}`
        : source.kind === 'formlabs'
          ? source.techSpecsUrl
          : source.storefrontUrl,
    revision: source.kind === 'open-resin' ? source.revision : checkedAt,
    license: source.kind === 'open-resin' ? source.license : 'manufacturer product data',
  })
}
writeFileSync(manufacturerCatalogPath, `${JSON.stringify({ sources: manufacturerSources, presets: manufacturerPresets }, null, 2)}\n`)
const catalogPresets = [...communityPresets, ...manufacturerPresets]

rmSync(imagesRoot, { recursive: true, force: true })
mkdirSync(imagesRoot, { recursive: true })

const images: ManufacturerImage[] = []
const claimedPresetIds = new Set<string>()
for (const source of manifest.sources) {
  const synchronized =
    source.kind === 'open-resin'
      ? await synchronizeGithubSource(source, claimedPresetIds)
      : source.kind === 'github'
        ? await synchronizeGithubImages(source, claimedPresetIds)
        : source.kind === 'webpage'
          ? await synchronizeWebpageImages(source, claimedPresetIds)
          : source.kind === 'formlabs'
            ? await synchronizeFormlabsImages(source, claimedPresetIds)
            : await synchronizeShopifySource(source, claimedPresetIds)
  images.push(...synchronized)
  for (const image of synchronized) claimedPresetIds.add(image.presetId)
}
images.sort((first, second) => first.presetId.localeCompare(second.presetId))
writeFileSync(outputPath, `${JSON.stringify({ images }, null, 2)}\n`)
if (update) writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
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
    const dimensions = snapshotDimensions(sourcePageUrl) ?? (await storefrontBuildVolume(source, product, sourcePageUrl))
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

// Build volumes never change after launch, so only products missing from the snapshot cost a product page request.
function snapshotDimensions(sourcePageUrl: string) {
  const preset = previousPresetsByUrl.get(sourcePageUrl)
  return preset && { widthMm: preset.widthMm, depthMm: preset.depthMm, heightMm: preset.heightMm }
}

async function storefrontBuildVolume(
  source: Extract<ManufacturerImageSource, { kind: 'shopify' }>,
  product: ShopifyProduct,
  sourcePageUrl: string,
) {
  const response = await fetchWithRetry(sourcePageUrl)
  if (!response.ok) throw new Error(`${source.id} product page ${product.handle} returned ${response.status}`)
  const dimensions = parseBuildVolumeHtml(await response.text())
  if (!dimensions) throw new Error(`${source.id} product ${product.title} has no parseable build volume`)
  return dimensions
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

async function synchronizeGithubSource(source: Extract<ManufacturerImageSource, { kind: 'open-resin' }>, existingPresetIds: Set<string>) {
  const printersByModel = new Map<string, { printer: OpenResinPrinter; definitionPath: string }>()
  for (const definition of await loadOpenResinPrinters(source)) {
    if (!definition.printer.imageAssetPath) continue
    const normalizedTitle = normalizePrinterModel(definition.printer.name, source.brand)
    const model = source.titleAliases?.[normalizedTitle]
    const key = normalizePrinterModel(model ?? normalizedTitle)
    if (!printersByModel.has(key)) printersByModel.set(key, definition)
  }

  await synchronizeGithubLicense(source)

  const matched: ManufacturerImage[] = []
  for (const preset of catalogPresets.filter((candidate) => candidate.printType === 'resin' && candidate.brand === source.brand)) {
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

async function synchronizeGithubImages(source: Extract<ManufacturerImageSource, { kind: 'github' }>, existingPresetIds: Set<string>) {
  await synchronizeGithubLicense(source)
  const catalogPresetIds = new Set(catalogPresets.map((preset) => preset.id))
  const synchronizedImages: ManufacturerImage[] = []
  for (const [presetId, imagePath] of Object.entries(source.images)) {
    if (!catalogPresetIds.has(presetId) || existingPresetIds.has(presetId)) continue
    const sourceUrl = rawGithubUrl(source, imagePath)
    const extension = imageExtension(sourceUrl)
    const src = `/printer-presets/manufacturer/${presetId}.${extension}`
    const response = await fetchWithRetry(sourceUrl)
    if (!response.ok) throw new Error(`${source.id} image for ${presetId} returned ${response.status}`)
    writeFileSync(path.join(root, 'public', src), Buffer.from(await response.arrayBuffer()))
    synchronizedImages.push({
      presetId,
      sourceId: source.id,
      sourcePageUrl: `https://github.com/${source.repository}/blob/${source.revision}/${imagePath}`,
      sourceUrl,
      src,
      checkedAt,
    })
  }
  return synchronizedImages
}

async function synchronizeWebpageImages(source: Extract<ManufacturerImageSource, { kind: 'webpage' }>, existingPresetIds: Set<string>) {
  const catalogPresetIds = new Set(catalogPresets.map((preset) => preset.id))
  const synchronizedImages: ManufacturerImage[] = []
  for (const [presetId, sourcePageUrl] of Object.entries(source.pages)) {
    if (!catalogPresetIds.has(presetId) || existingPresetIds.has(presetId)) continue
    const pageResponse = await fetchWithRetry(sourcePageUrl)
    if (!pageResponse.ok) throw new Error(`${source.id} page for ${presetId} returned ${pageResponse.status}`)
    const sourceUrl = extractProductImageUrl(await pageResponse.text(), sourcePageUrl)
    if (!sourceUrl) throw new Error(`${source.id} page for ${presetId} has no product image`)
    const extension = imageExtension(sourceUrl)
    const src = `/printer-presets/manufacturer/${presetId}.${extension}`
    const imageResponse = await fetchWithRetry(sourceUrl)
    if (!imageResponse.ok) throw new Error(`${source.id} image for ${presetId} returned ${imageResponse.status}`)
    writeFileSync(path.join(root, 'public', src), Buffer.from(await imageResponse.arrayBuffer()))
    synchronizedImages.push({ presetId, sourceId: source.id, sourcePageUrl, sourceUrl, src, checkedAt })
  }
  return synchronizedImages
}

async function synchronizeFormlabsCatalog(source: Extract<ManufacturerImageSource, { kind: 'formlabs' }>) {
  const response = await fetchWithRetry(source.techSpecsUrl)
  if (!response.ok) throw new Error(`${source.id} tech specs returned ${response.status}`)
  const printers = parseFormlabsTechSpecs(await response.text())
  if (!printers.length) throw new Error(`${source.id} tech specs have no parseable build volumes`)
  return printers.map(({ model, ...dimensions }) => ({
    id: formlabsPresetId(source.brand, model),
    brand: source.brand,
    model,
    printType: 'resin' as const,
    ...dimensions,
    source: { id: source.id, url: source.techSpecsUrl },
  }))
}

async function synchronizeFormlabsImages(source: Extract<ManufacturerImageSource, { kind: 'formlabs' }>, existingPresetIds: Set<string>) {
  const response = await fetchWithRetry(source.productsUrl)
  if (!response.ok) throw new Error(`${source.id} products page returned ${response.status}`)
  const products = new Map(parseFormlabsProductImages(await response.text()).map((product) => [product.model, product]))
  const matched: ManufacturerImage[] = []
  for (const preset of catalogPresets.filter((candidate) => candidate.brand === source.brand)) {
    if (existingPresetIds.has(preset.id)) continue
    const product = products.get(source.imageAliases[preset.model] ?? preset.model)
    if (!product) continue
    const extension = imageExtension(product.imageUrl)
    const src = `/printer-presets/manufacturer/${preset.id}.${extension}`
    const imageResponse = await fetchWithRetry(product.imageUrl)
    if (!imageResponse.ok) throw new Error(`${source.id} image for ${preset.id} returned ${imageResponse.status}`)
    writeFileSync(path.join(root, 'public', src), Buffer.from(await imageResponse.arrayBuffer()))
    matched.push({
      presetId: preset.id,
      sourceId: source.id,
      sourcePageUrl: new URL(product.pagePath, source.productsUrl).href,
      sourceUrl: product.imageUrl,
      src,
      checkedAt,
    })
  }
  return matched
}

async function synchronizeGithubCatalog(source: Extract<ManufacturerImageSource, { kind: 'open-resin' }>) {
  const excludeTitlePattern = source.catalog?.excludeTitlePattern ? new RegExp(source.catalog.excludeTitlePattern, 'i') : undefined
  return (await loadOpenResinPrinters(source)).flatMap(({ printer, definitionPath }) => {
    if (excludeTitlePattern?.test(printer.name)) return []
    const dimensions = openResinBuildVolume(printer)
    if (!dimensions) return []
    const normalizedTitle = normalizePrinterModel(printer.name, source.brand)
    const model = source.titleAliases?.[normalizedTitle] ?? printer.name
    return [
      {
        id: printerPresetId('resin', source.brand, model),
        brand: source.brand,
        model,
        printType: 'resin' as const,
        ...dimensions,
        source: {
          id: source.id,
          url: `https://github.com/${source.repository}/blob/${source.revision}/${definitionPath}`,
        },
      },
    ]
  })
}

async function loadOpenResinPrinters(source: Extract<ManufacturerImageSource, { kind: 'open-resin' }>) {
  const cached = openResinPrinters.get(source.id)
  if (cached) return cached
  const definitions: { printer: OpenResinPrinter; definitionPath: string }[] = []
  for (const definitionPath of await githubDefinitionPaths(source)) {
    const response = await fetchWithRetry(rawGithubUrl(source, definitionPath))
    if (!response.ok) throw new Error(`${source.id} definition ${definitionPath} returned ${response.status}`)
    for (const printer of (await response.json()) as OpenResinPrinter[]) definitions.push({ printer, definitionPath })
  }
  openResinPrinters.set(source.id, definitions)
  return definitions
}

async function githubDefinitionPaths(source: Extract<ManufacturerImageSource, { kind: 'open-resin' }>) {
  const response = await fetchWithRetry(`https://api.github.com/repos/${source.repository}/git/trees/${source.revision}?recursive=1`)
  if (!response.ok) throw new Error(`${source.id} repository tree returned ${response.status}`)
  const tree = (await response.json()) as { truncated?: boolean; tree?: { path: string; type: string }[] }
  if (tree.truncated || !tree.tree) throw new Error(`${source.id} repository tree is incomplete`)
  const paths = definitionPathsFromTree(tree.tree, source.definitionsPath)
  if (!paths.length) throw new Error(`${source.id} has no printer definitions under ${source.definitionsPath}`)
  return paths
}

async function latestGithubRevision(source: Extract<ManufacturerImageSource, { kind: 'github' | 'open-resin' }>) {
  const response = await fetchWithRetry(`https://api.github.com/repos/${source.repository}/commits/${source.branch}`)
  if (!response.ok) throw new Error(`${source.id} branch ${source.branch} returned ${response.status}`)
  const commit = (await response.json()) as { sha?: string }
  if (!commit.sha) throw new Error(`${source.id} branch ${source.branch} returned no revision`)
  return commit.sha
}

async function synchronizeGithubLicense(source: Extract<ManufacturerImageSource, { kind: 'github' | 'open-resin' }>) {
  const response = await fetchWithRetry(rawGithubUrl(source, source.licensePath))
  if (!response.ok) throw new Error(`${source.id} license returned ${response.status}`)
  writeFileSync(path.join(root, source.licenseOutput), await response.text())
}

function rawGithubUrl(source: Extract<ManufacturerImageSource, { kind: 'github' | 'open-resin' }>, filePath: string) {
  return `https://raw.githubusercontent.com/${source.repository}/${source.revision}/${filePath}`
}

async function paceHost(hostname: string) {
  const wait = (lastRequestAt.get(hostname) ?? 0) + 1000 - Date.now()
  if (wait > 0) await delay(wait)
  lastRequestAt.set(hostname, Date.now())
}

function fetchWithRetry(url: string) {
  return pRetry(
    async () => {
      await paceHost(new URL(url).hostname)
      const response = await httpsGet(url)
      if (response.status === 429) await delay(Math.min(Number(response.headers.get('retry-after')) || 5, 120) * 1000)
      if (response.status === 429 || response.status >= 500) throw new Error(`${url} returned ${response.status}`)
      return response
    },
    { retries: 3, minTimeout: 500 },
  )
}

// Shopify storefronts answer Node's fetch() with 429 but accept a plain request carrying only these headers.
function httpsGet(url: string, redirects = 5): Promise<Response> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: requestHeaders(url) }, (response) => {
        const status = response.statusCode ?? 0
        if (status >= 300 && status < 400 && response.headers.location && redirects > 0) {
          response.resume()
          resolve(httpsGet(new URL(response.headers.location, url).href, redirects - 1))
          return
        }
        const chunks: Buffer[] = []
        response
          .on('data', (chunk: Buffer) => chunks.push(chunk))
          .on('end', () => {
            const headers = new Headers()
            for (const [name, value] of Object.entries(response.headers)) if (typeof value === 'string') headers.set(name, value)
            resolve(new Response(Buffer.concat(chunks), { status, headers }))
          })
          .on('error', reject)
      })
      .on('error', reject)
  })
}

function requestHeaders(url: string) {
  const headers: Record<string, string> = { accept: '*/*', 'user-agent': 'STL Quest printer catalog sync' }
  const token = process.env.GITHUB_TOKEN
  if (token && new URL(url).hostname === 'api.github.com') headers.authorization = `Bearer ${token}`
  return headers
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
