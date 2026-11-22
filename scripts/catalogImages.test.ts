import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkCatalogImages, syncCatalogImages } from './catalogImages'

let root: string
const imagesPath = () => path.join(root, 'images.json')
const publicRoot = () => path.join(root, 'public')
const png = () =>
  sharp({ create: { width: 4, height: 4, channels: 3, background: '#f00' } })
    .png()
    .toBuffer()
const source = (presetId: string) => ({
  presetId,
  sourcePageUrl: `https://example.com/${presetId}`,
  sourceUrl: `https://cdn.example.com/${presetId}.png`,
})

function writeImages(images: object[]) {
  writeFileSync(imagesPath(), JSON.stringify({ images }))
}

async function sync(refresh = false) {
  const fetchImage = vi.fn(async () => png())
  await syncCatalogImages({ imagesPath: imagesPath(), publicRoot: publicRoot(), directory: 'resin-presets', refresh, fetchImage })
  return fetchImage
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'stlquest-catalog-images-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('syncCatalogImages', () => {
  it('downloads an image that has no committed file', async () => {
    writeImages([source('resin-a')])
    await sync()
    expect(existsSync(path.join(publicRoot(), 'resin-presets/resin-a.webp'))).toBe(true)
  })

  it('records where the downloaded image is served from', async () => {
    writeImages([source('resin-a')])
    await sync()
    expect(JSON.parse(readFileSync(imagesPath(), 'utf8')).images[0].src).toBe('/resin-presets/resin-a.webp')
  })

  it('leaves an image with a committed file alone so a sync only asks stores for new ones', async () => {
    mkdirSync(path.join(publicRoot(), 'resin-presets'), { recursive: true })
    writeFileSync(path.join(publicRoot(), 'resin-presets/resin-a.webp'), 'kept')
    writeImages([{ ...source('resin-a'), src: '/resin-presets/resin-a.webp', checkedAt: '2026-01-01' }])
    expect(await sync()).not.toHaveBeenCalled()
  })

  it('downloads every image again when refreshing', async () => {
    mkdirSync(path.join(publicRoot(), 'resin-presets'), { recursive: true })
    writeFileSync(path.join(publicRoot(), 'resin-presets/resin-a.webp'), 'stale')
    writeImages([{ ...source('resin-a'), src: '/resin-presets/resin-a.webp', checkedAt: '2026-01-01' }])
    expect(await sync(true)).toHaveBeenCalledWith('https://cdn.example.com/resin-a.png')
  })

  it('keeps a committed file when its source fails during a refresh', async () => {
    mkdirSync(path.join(publicRoot(), 'resin-presets'), { recursive: true })
    writeFileSync(path.join(publicRoot(), 'resin-presets/resin-a.webp'), 'kept')
    writeImages([{ ...source('resin-a'), src: '/resin-presets/resin-a.webp', checkedAt: '2026-01-01' }])
    const fetchImage = vi.fn(async () => Promise.reject(new Error('gone')))
    await syncCatalogImages({ imagesPath: imagesPath(), publicRoot: publicRoot(), directory: 'resin-presets', refresh: true, fetchImage })
    expect(readFileSync(path.join(publicRoot(), 'resin-presets/resin-a.webp'), 'utf8')).toBe('kept')
  })

  it('reports the images whose source failed during a refresh', async () => {
    mkdirSync(path.join(publicRoot(), 'resin-presets'), { recursive: true })
    writeFileSync(path.join(publicRoot(), 'resin-presets/resin-a.webp'), 'kept')
    writeImages([{ ...source('resin-a'), src: '/resin-presets/resin-a.webp', checkedAt: '2026-01-01' }])
    const fetchImage = vi.fn(async () => Promise.reject(new Error('gone')))
    const result = await syncCatalogImages({
      imagesPath: imagesPath(),
      publicRoot: publicRoot(),
      directory: 'resin-presets',
      refresh: true,
      fetchImage,
    })
    expect(result.unreachable).toEqual(['resin-a'])
  })

  it('fails when a new image cannot be downloaded', async () => {
    writeImages([source('resin-a')])
    const fetchImage = vi.fn(async () => Promise.reject(new Error('gone')))
    await expect(
      syncCatalogImages({ imagesPath: imagesPath(), publicRoot: publicRoot(), directory: 'resin-presets', refresh: false, fetchImage }),
    ).rejects.toThrow('gone')
  })

  it('removes a file no image records', async () => {
    mkdirSync(path.join(publicRoot(), 'resin-presets'), { recursive: true })
    writeFileSync(path.join(publicRoot(), 'resin-presets/resin-gone.webp'), 'orphan')
    writeImages([source('resin-a')])
    await sync()
    expect(existsSync(path.join(publicRoot(), 'resin-presets/resin-gone.webp'))).toBe(false)
  })
})

describe('checkCatalogImages', () => {
  const check = (presetIds: string[]) =>
    checkCatalogImages({ imagesPath: imagesPath(), publicRoot: publicRoot(), directory: 'resin-presets', presetIds: new Set(presetIds) })

  it('rejects an image for a preset the catalogue lacks', async () => {
    writeImages([source('resin-a')])
    await sync()
    expect(() => check([])).toThrow('Image for unknown preset resin-a')
  })

  it('rejects an image whose file is missing', () => {
    mkdirSync(path.join(publicRoot(), 'resin-presets'), { recursive: true })
    writeImages([{ ...source('resin-a'), src: '/resin-presets/resin-a.webp', checkedAt: '2026-01-01' }])
    expect(() => check(['resin-a'])).toThrow('Missing image file for resin-a')
  })

  it('counts the images of a valid catalogue', async () => {
    writeImages([source('resin-a')])
    await sync()
    expect(check(['resin-a'])).toBe(1)
  })
})
