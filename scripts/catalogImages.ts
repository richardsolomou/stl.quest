import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fetchWithRetry } from './catalogFetch'
import { writePresetImage } from './printerCatalog'

/**
 * A hand-picked image for one catalogue preset; `note` says how a near match differs from the product, and `src` and
 * `checkedAt` are filled in once it is downloaded.
 */
export type CatalogImage = { presetId: string; sourcePageUrl: string; sourceUrl: string; note?: string; src?: string; checkedAt?: string }

type CatalogImages = {
  imagesPath: string
  publicRoot: string
  /** The folder under `publicRoot` the images are served from. */
  directory: string
}

const readImages = (imagesPath: string) => (JSON.parse(readFileSync(imagesPath, 'utf8')) as { images: CatalogImage[] }).images
const imageSrc = (directory: string, presetId: string) => `/${directory}/${presetId}.webp`

/**
 * Downloads each recorded image without a committed file, or every one with `refresh`, and removes files no image
 * records. Skipping committed files keeps an ordinary sync from asking every store again. A refresh keeps the committed
 * file of an image whose source has gone or refuses scripts, and reports it as unreachable.
 */
export async function syncCatalogImages({
  imagesPath,
  publicRoot,
  directory,
  refresh,
  fetchImage = fetchImageBytes,
}: CatalogImages & { refresh: boolean; fetchImage?: (url: string) => Promise<Buffer> }) {
  const folder = path.join(publicRoot, directory)
  mkdirSync(folder, { recursive: true })
  const checkedAt = new Date().toISOString().slice(0, 10)
  const images: CatalogImage[] = []
  const unreachable: string[] = []
  for (const image of readImages(imagesPath)) {
    const src = imageSrc(directory, image.presetId)
    const output = path.join(publicRoot, src)
    if (!refresh && image.checkedAt && existsSync(output)) {
      images.push({ ...image, src })
      continue
    }
    try {
      await writePresetImage(await fetchImage(image.sourceUrl), output)
    } catch (error) {
      if (!image.checkedAt || !existsSync(output)) throw error
      unreachable.push(image.presetId)
      images.push({ ...image, src })
      continue
    }
    images.push({ ...image, src, checkedAt })
  }
  const recorded = new Set(images.map((image) => path.basename(image.src!)))
  for (const file of readdirSync(folder)) if (!recorded.has(file)) rmSync(path.join(folder, file))
  images.sort((first, second) => first.presetId.localeCompare(second.presetId))
  writeFileSync(imagesPath, `${JSON.stringify({ images }, null, 2)}\n`)
  return { count: images.length, unreachable }
}

/** Verifies without the network that every image belongs to a preset, cites HTTPS sources, and has its committed file. */
export function checkCatalogImages({ imagesPath, publicRoot, directory, presetIds }: CatalogImages & { presetIds: ReadonlySet<string> }) {
  const images = readImages(imagesPath)
  const seen = new Set<string>()
  for (const image of images) {
    if (!presetIds.has(image.presetId)) throw new Error(`Image for unknown preset ${image.presetId}`)
    if (seen.has(image.presetId)) throw new Error(`Duplicate image for ${image.presetId}`)
    seen.add(image.presetId)
    if (!image.sourcePageUrl.startsWith('https://') || !image.sourceUrl.startsWith('https://') || !image.checkedAt)
      throw new Error(`Incomplete image source for ${image.presetId}`)
    if (image.src !== imageSrc(directory, image.presetId) || !existsSync(path.join(publicRoot, image.src)))
      throw new Error(`Missing image file for ${image.presetId}; run tsx scripts/updateCatalogImages.ts`)
  }
  for (const file of readdirSync(path.join(publicRoot, directory)))
    if (!images.some((image) => image.src === `/${directory}/${file}`)) throw new Error(`Unreferenced image ${directory}/${file}`)
  return images.length
}

async function fetchImageBytes(url: string) {
  const response = await fetchWithRetry(url)
  if (!response.ok) throw new Error(`${url} returned ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}
