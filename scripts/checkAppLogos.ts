import path from 'node:path'
import { checkAppLogos } from './appLogos'
import { APP_LOGOS } from '../src/core/appLogos'

const root = path.resolve(import.meta.dirname, '..')
const count = checkAppLogos({
  sourcesPath: path.join(root, 'catalogs/app-logos/sources.json'),
  publicRoot: path.join(root, 'public'),
  logos: APP_LOGOS,
})
console.log(`Validated ${count} app logos.`)
