import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function syncReleaseVersion(
  packagePath = path.resolve('package.json'),
  manifestPath = path.resolve('deploy/truenas/printhub/app.yaml'),
) {
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { version?: unknown }
  if (typeof packageJson.version !== 'string') throw new Error('package.json must contain a version')

  const manifest = fs.readFileSync(manifestPath, 'utf8')
  if (!/^app_version: .*$/m.test(manifest)) throw new Error('TrueNAS manifest must contain app_version')

  fs.writeFileSync(manifestPath, manifest.replace(/^app_version: .*$/m, `app_version: ${packageJson.version}`))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) syncReleaseVersion()
