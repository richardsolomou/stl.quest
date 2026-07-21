import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalAssetStore } from '../../adapters/filesystem'
import { LocalEventBus } from '../../adapters/events'
import { createDatabase } from '../../db'
import { DrizzleRepository } from '../../db/repository'
import { user } from '../../db/schema'
import type { AppEvent, Telemetry } from '../../core/types'
import { exportBinaryStl } from '../../core/mesh/stl'
import { MAX_UPLOAD_BYTES } from '../../core/uploadLimits'
import { AssetGenerationQueue } from './queue'

const telemetry: Telemetry = { capture: async () => undefined, exception: async () => undefined }

function triangleStl(width = 10, depth = 10, height = 0): Uint8Array {
  const positions = new Float32Array([0, 0, 0, width, 0, 0, 0, depth, height])
  return exportBinaryStl(positions, new Uint32Array([0, 1, 2]))
}

describe('asset generation queue', () => {
  let root: string
  let repository: DrizzleRepository
  let assets: LocalAssetStore
  let events: LocalEventBus
  let queue: AssetGenerationQueue

  beforeEach(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-assets-'))
    repository = new DrizzleRepository(createDatabase(':memory:'))
    repository.database
      .insert(user)
      .values({
        id: 'owner',
        name: 'Owner',
        email: 'owner@example.com',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        role: 'requester',
      })
      .run()
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
    const filePath = `todo/${crypto.randomUUID()}.stl`
    await assets.write(filePath, file)
    return repository.createRequest({
      name: 'Model',
      fileName: 'model.stl',
      filePath,
      quantity: 1,
      ownerUserId: 'owner',
      requestedPrintType: 'resin',
    })
  }

  it('generates a thumbnail and publishes an update', async () => {
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

  it('reassigns automatically assigned models after measuring their dimensions', async () => {
    repository.replacePrinterProfiles([
      { id: 'small', name: 'Small', printType: 'resin', widthMm: 100, depthMm: 100, heightMm: 100 },
      { id: 'large', name: 'Large', printType: 'resin', widthMm: 200, depthMm: 200, heightMm: 200 },
    ])
    const id = await requestWithFile(triangleStl(150, 80, 120))
    repository.updateRequest(id, { printerId: 'small', requestedPrintType: null, automaticPrinterAssignment: true })

    queue.enqueue(id)
    await queue.idle()

    expect(repository.getRequest(id)).toMatchObject({
      printerId: 'large',
      automaticPrinterAssignment: true,
      modelDimensions: { widthMm: 150, depthMm: 80, heightMm: 120 },
    })
  })

  it('reports visual queue depth and configured concurrency', async () => {
    const id = await requestWithFile()
    expect(queue.stats()).toEqual({
      queued: 0,
      pending: 0,
      concurrency: 8,
      worker: false,
      visual: { queued: 0, running: 0, concurrency: 8 },
    })
    queue.enqueue(id)
    expect(queue.stats().visual.queued + queue.stats().visual.running).toBe(1)
    await queue.idle()
  })

  it('processes multiple jobs concurrently', async () => {
    queue = new AssetGenerationQueue(repository, assets, events, telemetry, 2)
    const firstId = await requestWithFile()
    const secondId = await requestWithFile()
    const originalRead = assets.read.bind(assets)
    let startedReads = 0
    let resolveStarted!: () => void
    let releaseReads!: () => void
    const bothStarted = new Promise<void>((resolve) => (resolveStarted = resolve))
    const readsReleased = new Promise<void>((resolve) => (releaseReads = resolve))
    vi.spyOn(assets, 'read').mockImplementation(async (key) => {
      startedReads += 1
      if (startedReads === 2) resolveStarted()
      await readsReleased
      return originalRead(key)
    })

    queue.enqueue(firstId)
    queue.enqueue(secondId)
    await bothStarted
    expect(queue.stats().visual).toEqual({ queued: 0, running: 2, concurrency: 2 })
    releaseReads()
    await queue.idle()
  })

  it('serializes jobs that each consume the source byte budget', async () => {
    queue = new AssetGenerationQueue(repository, assets, events, telemetry, 2, undefined, triangleStl().byteLength * 4)
    const firstId = await requestWithFile()
    const secondId = await requestWithFile()
    const originalRead = assets.read.bind(assets)
    let startedReads = 0
    let releaseFirst!: () => void
    const firstReleased = new Promise<void>((resolve) => (releaseFirst = resolve))
    vi.spyOn(assets, 'read').mockImplementation(async (key) => {
      startedReads += 1
      if (startedReads === 1) await firstReleased
      return originalRead(key)
    })

    queue.enqueue(firstId)
    queue.enqueue(secondId)
    await vi.waitFor(() => expect(startedReads).toBe(1))
    releaseFirst()
    await queue.idle()

    expect(startedReads).toBe(2)
  })

  it('runs smaller queued sources before larger ones', async () => {
    const file = triangleStl()
    queue = new AssetGenerationQueue(repository, assets, events, telemetry, 1, undefined, file.byteLength * 12)
    const firstId = await requestWithFile(file)
    const secondId = await requestWithFile(file)
    const thirdId = await requestWithFile(file)
    const firstPath = repository.getRequest(firstId)!.filePath
    const secondPath = repository.getRequest(secondId)!.filePath
    const thirdPath = repository.getRequest(thirdId)!.filePath
    const originalRead = assets.read.bind(assets)
    const sizes = new Map([
      [firstPath, file.byteLength],
      [secondPath, file.byteLength],
      [thirdPath, file.byteLength / 2],
    ])
    const startedReads: string[] = []
    let releaseFirst!: () => void
    const firstReleased = new Promise<void>((resolve) => (releaseFirst = resolve))
    const stat = vi.spyOn(assets, 'stat').mockImplementation(async (key) => ({ size: sizes.get(key)! }))
    vi.spyOn(assets, 'read').mockImplementation(async (key) => {
      startedReads.push(key)
      if (key === firstPath) await firstReleased
      return originalRead(key)
    })

    queue.enqueue(firstId)
    queue.enqueue(secondId)
    queue.enqueue(thirdId)
    await vi.waitFor(() => expect(startedReads).toEqual([firstPath]))
    await vi.waitFor(() => expect(stat).toHaveBeenCalledTimes(3))
    releaseFirst()
    await vi.waitFor(() => expect(startedReads.length).toBeGreaterThanOrEqual(2))

    expect(startedReads[1]).toBe(thirdPath)
    await queue.idle()
  })

  it('runs small jobs concurrently within the source byte budget', async () => {
    const fileBytes = triangleStl().byteLength
    queue = new AssetGenerationQueue(repository, assets, events, telemetry, 2, undefined, fileBytes * 8)
    const firstId = await requestWithFile()
    const secondId = await requestWithFile()
    const originalRead = assets.read.bind(assets)
    let startedReads = 0
    let resolveStarted!: () => void
    let releaseReads!: () => void
    const bothStarted = new Promise<void>((resolve) => (resolveStarted = resolve))
    const readsReleased = new Promise<void>((resolve) => (releaseReads = resolve))
    vi.spyOn(assets, 'read').mockImplementation(async (key) => {
      startedReads += 1
      if (startedReads === 2) resolveStarted()
      await readsReleased
      return originalRead(key)
    })

    queue.enqueue(firstId)
    queue.enqueue(secondId)
    await bothStarted
    releaseReads()
    await queue.idle()

    expect(startedReads).toBe(2)
  })

  it('rejects sources that exceed the generation memory budget', async () => {
    const file = triangleStl()
    queue = new AssetGenerationQueue(repository, assets, events, telemetry, 2, undefined, file.byteLength * 2)
    const id = await requestWithFile(file)
    const read = vi.spyOn(assets, 'read')

    queue.enqueue(id)
    await queue.idle()

    expect(read).not.toHaveBeenCalled()
    expect(repository.assetGenerationJobs(id)).toEqual([
      expect.objectContaining({ stage: 'preview', status: 'failed', error: expect.stringContaining('generation limit') }),
      expect.objectContaining({ stage: 'thumbnail', status: 'failed', error: expect.stringContaining('generation limit') }),
    ])
  })

  it('generates assets at the upload size limit', async () => {
    const id = await requestWithFile()
    vi.spyOn(assets, 'stat').mockResolvedValue({ size: MAX_UPLOAD_BYTES })

    queue.enqueue(id)
    await queue.idle()

    expect(repository.getRequest(id)!.hasThumbnail).toBe(true)
  })

  it('preserves a completed thumbnail when preview work is interrupted', async () => {
    const id = await requestWithFile()
    repository.startAssetGeneration(id, ['thumbnail', 'preview'])
    repository.finishAssetGeneration(id, 'thumbnail', { status: 'ready', path: '.printhub/thumbnails/model.png' })

    const restarted = new AssetGenerationQueue(repository, assets, events, telemetry)
    restarted.backfill()
    await restarted.idle()
    expect(repository.assetGenerationJobs(id)).toEqual([
      expect.objectContaining({ stage: 'preview', status: 'skipped' }),
      expect.objectContaining({ stage: 'thumbnail', status: 'ready' }),
    ])
  })

  it('retries after a transient storage read failure', async () => {
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
