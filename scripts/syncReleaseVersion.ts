import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function syncReleaseVersion(
  packagePath = path.resolve('package.json'),
  manifestPath = path.resolve('deploy/truenas/stlquest/app.yaml'),
  imageValuesPath = path.resolve('deploy/truenas/stlquest/ix_values.yaml'),
) {
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { version?: unknown }
  if (typeof packageJson.version !== 'string') throw new Error('package.json must contain a version')

  const manifest = fs.readFileSync(manifestPath, 'utf8')
  if (!/^app_version: .*$/m.test(manifest)) throw new Error('TrueNAS manifest must contain app_version')
  const imageValues = fs.readFileSync(imageValuesPath, 'utf8')
  if (!/^    tag: .*$/m.test(imageValues)) throw new Error('TrueNAS image values must contain images.image.tag')

  fs.writeFileSync(manifestPath, manifest.replace(/^app_version: .*$/m, `app_version: v${packageJson.version}`))
  fs.writeFileSync(imageValuesPath, imageValues.replace(/^    tag: .*$/m, `    tag: v${packageJson.version}`))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) syncReleaseVersion()
