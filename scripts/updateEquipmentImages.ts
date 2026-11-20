import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fetchWithRetry } from './catalogFetch'
import { writePresetImage } from './printerCatalog'

type EquipmentImage = { presetId: string; sourcePageUrl: string; sourceUrl: string; src: string; checkedAt: string }

const root = path.resolve(import.meta.dirname, '..')
const imagesPath = path.join(root, 'catalogs/equipment/images.json')
const imagesRoot = path.join(root, 'public/equipment-presets')
const manifest = JSON.parse(readFileSync(imagesPath, 'utf8')) as { images: EquipmentImage[] }
const checkedAt = new Date().toISOString().slice(0, 10)

rmSync(imagesRoot, { recursive: true, force: true })
mkdirSync(imagesRoot, { recursive: true })

const images: EquipmentImage[] = []
for (const image of manifest.images) {
  const response = await fetchWithRetry(image.sourceUrl)
  if (!response.ok) throw new Error(`Image for ${image.presetId} returned ${response.status}`)
  const src = `/equipment-presets/${image.presetId}.webp`
  await writePresetImage(Buffer.from(await response.arrayBuffer()), path.join(root, 'public', src))
  images.push({ ...image, src, checkedAt })
}
images.sort((first, second) => first.presetId.localeCompare(second.presetId))
writeFileSync(imagesPath, `${JSON.stringify({ images }, null, 2)}\n`)
console.log(`Synchronized ${images.length} equipment images.`)
