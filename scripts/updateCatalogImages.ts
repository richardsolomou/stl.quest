import path from 'node:path'
import { syncCatalogImages } from './catalogImages'

const root = path.resolve(import.meta.dirname, '..')
const refresh = process.argv.includes('--refresh')
const catalogs = [
  { name: 'equipment', imagesPath: 'catalogs/equipment/images.json', directory: 'equipment-presets' },
  { name: 'resin', imagesPath: 'catalogs/resins/images.json', directory: 'resin-presets' },
  { name: 'wear part', imagesPath: 'catalogs/parts/images.json', directory: 'part-presets' },
  { name: 'supply', imagesPath: 'catalogs/supplies/images.json', directory: 'supply-presets' },
]

for (const { name, imagesPath, directory } of catalogs) {
  const { count, unreachable } = await syncCatalogImages({
    imagesPath: path.join(root, imagesPath),
    publicRoot: path.join(root, 'public'),
    directory,
    refresh,
  })
  console.log(`Synchronized ${count} ${name} images.`)
  if (unreachable.length) console.warn(`Kept the committed ${name} images whose source failed: ${unreachable.join(', ')}`)
}
