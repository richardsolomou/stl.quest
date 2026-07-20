import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { syncReleaseVersion } from './syncReleaseVersion'

describe('syncReleaseVersion', () => {
  it('copies the application version into the TrueNAS manifest and image values', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'printhub-release-'))
    const packagePath = path.join(directory, 'package.json')
    const manifestPath = path.join(directory, 'app.yaml')
    const imageValuesPath = path.join(directory, 'ix_values.yaml')
    fs.writeFileSync(packagePath, JSON.stringify({ version: '1.2.3' }))
    fs.writeFileSync(manifestPath, 'annotations: {}\napp_version: 0.17.0\nversion: 1.0.0\n')
    fs.writeFileSync(imageValuesPath, 'images:\n  image:\n    repository: example/printhub\n    tag: 0.17.0\n')

    syncReleaseVersion(packagePath, manifestPath, imageValuesPath)

    expect(fs.readFileSync(manifestPath, 'utf8')).toBe('annotations: {}\napp_version: 1.2.3\nversion: 1.0.0\n')
    expect(fs.readFileSync(imageValuesPath, 'utf8')).toBe('images:\n  image:\n    repository: example/printhub\n    tag: 1.2.3\n')
  })

  it('rejects a manifest without an application version field', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'printhub-release-'))
    const packagePath = path.join(directory, 'package.json')
    const manifestPath = path.join(directory, 'app.yaml')
    const imageValuesPath = path.join(directory, 'ix_values.yaml')
    fs.writeFileSync(packagePath, JSON.stringify({ version: '1.2.3' }))
    fs.writeFileSync(manifestPath, 'annotations: {}\n')
    fs.writeFileSync(imageValuesPath, 'images:\n  image:\n    tag: 0.17.0\n')

    expect(() => syncReleaseVersion(packagePath, manifestPath, imageValuesPath)).toThrow('TrueNAS manifest must contain app_version')
  })

  it('rejects image values without a tag before changing the manifest', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'printhub-release-'))
    const packagePath = path.join(directory, 'package.json')
    const manifestPath = path.join(directory, 'app.yaml')
    const imageValuesPath = path.join(directory, 'ix_values.yaml')
    const manifest = 'annotations: {}\napp_version: 0.17.0\n'
    fs.writeFileSync(packagePath, JSON.stringify({ version: '1.2.3' }))
    fs.writeFileSync(manifestPath, manifest)
    fs.writeFileSync(imageValuesPath, 'images:\n  image:\n    repository: example/printhub\n')

    expect(() => syncReleaseVersion(packagePath, manifestPath, imageValuesPath)).toThrow(
      'TrueNAS image values must contain images.image.tag',
    )
    expect(fs.readFileSync(manifestPath, 'utf8')).toBe(manifest)
  })
})
