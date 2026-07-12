import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalAssetStore } from '../../adapters/filesystem'
import { LocalEventBus } from '../../adapters/events'
import { SqliteRepository } from '../../adapters/sqlite'
import type { AppEvent, Telemetry } from '../../core/types'
import { AssetGenerationQueue } from './queue'
import { exportBinaryStl } from './stl'

const telemetry: Telemetry = { capture: async () => undefined, exception: async () => undefined }

function triangleStl(): Uint8Array {
  const positions = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0])
  return exportBinaryStl(positions, new Uint32Array([0, 1, 2]))
}

describe('asset generation queue', () => {
  let root: string
  let repository: SqliteRepository
  let assets: LocalAssetStore
  let events: LocalEventBus
  let queue: AssetGenerationQueue

  beforeEach(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-assets-'))
    repository = new SqliteRepository(new Database(':memory:'))
    assets = new LocalAssetStore(root)
    await assets.initialize()
    events = new LocalEventBus()
    queue = new AssetGenerationQueue(repository, assets, events, telemetry)
  })

  afterEach(async () => {
    repository.close()
    await fs.promises.rm(root, { recursive: true })
  })

  async function requestWithFile(file: Uint8Array = triangleStl()) {
    await assets.write('todo/model.stl', file)
    return repository.createRequest({ name: 'Model', fileName: 'model.stl', filePath: 'todo/model.stl', quantity: 1, requesterEmail: 'owner@example.com' })
  }

  it('generates a thumbnail, stamps the request, and publishes an update', async () => {
    const id = await requestWithFile()
    const published: AppEvent[] = []
    events.subscribe((event) => published.push(event))
    queue.enqueue(id)
    await queue.idle()
    const request = repository.getRequest(id)!
    expect(request.thumbnailPath).toMatch(/^\.printhub\/thumbnails\/.*\.png$/)
    expect(await assets.exists(request.thumbnailPath!)).toBe(true)
    expect(published).toContain('request.updated')
    expect(repository.requestsNeedingAssets()).toHaveLength(0)
  })

  it('backfills every unstamped request and skips stamped ones afterwards', async () => {
    const id = await requestWithFile()
    expect(repository.requestsNeedingAssets()).toEqual([id])
    queue.backfill()
    await queue.idle()
    expect(repository.getRequest(id)!.hasThumbnail).toBe(true)
    expect(repository.requestsNeedingAssets()).toHaveLength(0)
  })

  it('stamps an unparseable file as processed so it is not retried forever', async () => {
    const id = await requestWithFile(new TextEncoder().encode('not an stl'))
    queue.enqueue(id)
    await queue.idle()
    expect(repository.getRequest(id)!.hasThumbnail).toBe(false)
    expect(repository.requestsNeedingAssets()).toHaveLength(0)
  })

  it('leaves the request unstamped when storage cannot be read, so the next boot retries', async () => {
    const id = await requestWithFile()
    vi.spyOn(assets, 'read').mockRejectedValueOnce(new Error('storage offline'))
    queue.enqueue(id)
    await queue.idle()
    expect(repository.requestsNeedingAssets()).toEqual([id])
    queue.enqueue(id)
    await queue.idle()
    expect(repository.getRequest(id)!.hasThumbnail).toBe(true)
  })
})
