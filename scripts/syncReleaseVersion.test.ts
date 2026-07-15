import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { syncReleaseVersion } from './syncReleaseVersion'

describe('syncReleaseVersion', () => {
  it('copies the application version into the TrueNAS manifest', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'printhub-release-'))
    const packagePath = path.join(directory, 'package.json')
    const manifestPath = path.join(directory, 'app.yaml')
    fs.writeFileSync(packagePath, JSON.stringify({ version: '1.2.3' }))
    fs.writeFileSync(manifestPath, 'annotations: {}\napp_version: 0.17.0\nversion: 1.0.0\n')

    syncReleaseVersion(packagePath, manifestPath)

    expect(fs.readFileSync(manifestPath, 'utf8')).toBe('annotations: {}\napp_version: 1.2.3\nversion: 1.0.0\n')
  })

  it('rejects a manifest without an application version field', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'printhub-release-'))
    const packagePath = path.join(directory, 'package.json')
    const manifestPath = path.join(directory, 'app.yaml')
    fs.writeFileSync(packagePath, JSON.stringify({ version: '1.2.3' }))
    fs.writeFileSync(manifestPath, 'annotations: {}\n')

    expect(() => syncReleaseVersion(packagePath, manifestPath)).toThrow('TrueNAS manifest must contain app_version')
  })
})
