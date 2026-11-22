import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { isHttps } from './catalogChecks'

/** Where one app's committed logo came from, when it was read, and the license or trademark terms it is used under. */
type AppLogoSource = { appId: string; sourcePageUrl: string; sourceUrl: string; checkedAt?: string; license?: string; note?: string }

/** Verifies without the network that every app has exactly one sourced logo, its file is committed, and no file is stray. */
export function checkAppLogos({
  sourcesPath,
  publicRoot,
  logos,
}: {
  sourcesPath: string
  publicRoot: string
  logos: Record<string, string>
}) {
  const sources = (JSON.parse(readFileSync(sourcesPath, 'utf8')) as { logos: AppLogoSource[] }).logos
  const seen = new Set<string>()
  for (const source of sources) {
    if (!(source.appId in logos)) throw new Error(`Logo source for unknown app ${source.appId}`)
    if (seen.has(source.appId)) throw new Error(`Duplicate logo source for ${source.appId}`)
    seen.add(source.appId)
    if (
      !isHttps(source.sourcePageUrl) ||
      !isHttps(source.sourceUrl) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(source.checkedAt ?? '') ||
      !source.license
    )
      throw new Error(`Incomplete logo source for ${source.appId}`)
  }
  for (const [appId, src] of Object.entries(logos)) {
    if (!seen.has(appId)) throw new Error(`No logo source for ${appId}`)
    if (!existsSync(path.join(publicRoot, src))) throw new Error(`Missing logo file ${src}`)
  }
  const files = new Set(Object.values(logos))
  for (const file of readdirSync(path.join(publicRoot, 'app-logos')))
    if (!files.has(`/app-logos/${file}`)) throw new Error(`Unreferenced logo app-logos/${file}`)
  return sources.length
}
