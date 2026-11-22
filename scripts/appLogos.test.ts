import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkAppLogos } from './appLogos'

let root: string
const sourcesPath = () => path.join(root, 'sources.json')
const publicRoot = () => path.join(root, 'public')
const logos = { orcaslicer: '/app-logos/orcaslicer.svg' }
const source = (appId: string) => ({
  appId,
  sourcePageUrl: `https://github.com/example/${appId}`,
  sourceUrl: `https://raw.githubusercontent.com/example/${appId}/icon.svg`,
  checkedAt: '2026-11-22',
  license: 'AGPL-3.0-only; the name and logo are trademarks of their owner.',
})

function writeSources(sources: object[]) {
  writeFileSync(sourcesPath(), JSON.stringify({ logos: sources }))
}

function writeLogo(file: string) {
  writeFileSync(path.join(publicRoot(), 'app-logos', file), '<svg/>')
}

const check = () => checkAppLogos({ sourcesPath: sourcesPath(), publicRoot: publicRoot(), logos })

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'stlquest-app-logos-'))
  mkdirSync(path.join(publicRoot(), 'app-logos'), { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('checkAppLogos', () => {
  it('counts the logos when every app has a sourced file', () => {
    writeSources([source('orcaslicer')])
    writeLogo('orcaslicer.svg')
    expect(check()).toBe(1)
  })

  it('rejects an app with no recorded source', () => {
    writeSources([])
    writeLogo('orcaslicer.svg')
    expect(check).toThrow('No logo source for orcaslicer')
  })

  it('rejects a source for an app that shows no logo', () => {
    writeSources([source('orcaslicer'), source('unknown')])
    writeLogo('orcaslicer.svg')
    expect(check).toThrow('Logo source for unknown app unknown')
  })

  it('rejects a second source for the same app', () => {
    writeSources([source('orcaslicer'), source('orcaslicer')])
    writeLogo('orcaslicer.svg')
    expect(check).toThrow('Duplicate logo source for orcaslicer')
  })

  it('rejects a source page that is not HTTPS', () => {
    writeSources([{ ...source('orcaslicer'), sourcePageUrl: 'http://github.com/example' }])
    writeLogo('orcaslicer.svg')
    expect(check).toThrow('Incomplete logo source for orcaslicer')
  })

  it('rejects a source with no checked date', () => {
    writeSources([{ ...source('orcaslicer'), checkedAt: undefined }])
    writeLogo('orcaslicer.svg')
    expect(check).toThrow('Incomplete logo source for orcaslicer')
  })

  it('rejects a source with no license or trademark note', () => {
    writeSources([{ ...source('orcaslicer'), license: '' }])
    writeLogo('orcaslicer.svg')
    expect(check).toThrow('Incomplete logo source for orcaslicer')
  })

  it('rejects an app whose logo file is missing', () => {
    writeSources([source('orcaslicer')])
    expect(check).toThrow('Missing logo file /app-logos/orcaslicer.svg')
  })

  it('rejects a committed file no app shows', () => {
    writeSources([source('orcaslicer')])
    writeLogo('orcaslicer.svg')
    writeLogo('stale.png')
    expect(check).toThrow('Unreferenced logo app-logos/stale.png')
  })
})
