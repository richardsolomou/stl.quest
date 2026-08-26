import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalAssetStore } from '../../adapters/filesystem'
import { createDatabase } from '../../db'
import { DrizzleRepository } from '../../db/repository'
import { user } from '../../db/schema'
import type { AppEvent, EventBus, Telemetry } from '../../core/types'
import { exportBinaryStl } from '../../core/mesh/stl'
import { MAX_UPLOAD_BYTES } from '../../core/uploadLimits'
import { AssetGenerationQueue } from './queue'
import { STLQuestService } from '../../core/services'
import { UploadStaging } from '../../adapters/staging'

const telemetry: Telemetry = { capture: async () => undefined, exception: async () => undefined }

function triangleStl(width = 10, depth = 10, height = 0): Uint8Array {
  const positions = new Float32Array([0, 0, 0, width, 0, 0, 0, depth, height])
  return exportBinaryStl(positions, new Uint32Array([0, 1, 2]))
}

/** A closed mesh, so geometry analysis produces the volume a bounding box alone cannot. */
function sphereStl(radius: number, rings = 8, segments = 12): Uint8Array {
  const verts: number[] = []
  const point = (ring: number, segment: number) => {
    const phi = (ring / rings) * Math.PI
    const theta = (segment / segments) * 2 * Math.PI
    return [radius * Math.sin(phi) * Math.cos(theta), radius * Math.sin(phi) * Math.sin(theta), radius * Math.cos(phi)]
  }
  for (let ring = 0; ring < rings; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      const a = point(ring, segment)
      const b = point(ring + 1, segment)
      const c = point(ring + 1, segment + 1)
      const d = point(ring, segment + 1)
      verts.push(...a, ...b, ...c, ...a, ...c, ...d)
    }
  }
  const positions = new Float32Array(verts)
  const indices = new Uint32Array(positions.length / 3)
  for (let index = 0; index < indices.length; index++) indices[index] = index
  return exportBinaryStl(positions, indices)
}

describe('asset generation queue', () => {
  let root: string
  let repository: DrizzleRepository
  let assets: LocalAssetStore
  let events: EventBus
  let published: AppEvent[]
  let queue: AssetGenerationQueue

  beforeEach(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-assets-'))
    repository = await DrizzleRepository.create(createDatabase(':memory:'))
    await repository.database
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
    published = []
    events = { publish: (event) => published.push(event) }
    queue = new AssetGenerationQueue(repository, assets, events, telemetry)
  })

  afterEach(async () => {
    await repository.close()
    await fs.promises.rm(root, { recursive: true })
  })

  async function requestWithFile(file: Uint8Array = triangleStl()) {
    const filePath = `todo/${crypto.randomUUID()}.stl`
    await assets.write(filePath, file)
    return await repository.createRequest({
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
    await queue.enqueue(id)
    await queue.idle()
    const request = (await repository.getRequest(id))!
    expect(request.thumbnailPath).toMatch(/^thumbnails\/.*\.png$/)
    expect(await assets.exists(request.thumbnailPath!)).toBe(true)
    expect(published).toContain('request.updated')
    expect(await repository.requestsNeedingAssets()).toHaveLength(0)
  })

  it('regenerates every asset after the model is replaced', async () => {
    const staging = new UploadStaging(await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-assets-staging-')))
    await staging.initialize()
    const service = new STLQuestService(repository, assets, staging, events, telemetry, { remove: async () => undefined })
    const id = await requestWithFile(sphereStl(20))
    await queue.enqueue(id)
    await queue.idle()
    const before = (await repository.getRequest(id))!
    expect(before.modelVolumeMm3).toBeGreaterThan(0)

    const uploadId = 'replacement-upload-id'
    const part = staging.uploadPart(uploadId)
    await fs.promises.writeFile(part, sphereStl(40))
    await repository.createUploadSession(uploadId, 'owner', Date.now() + 60_000, 3)
    await service.attachModel(uploadId, part, id, 'replacement.stl', {
      id: 'owner',
      email: 'owner@example.com',
      name: 'Owner',
      role: 'admin',
    })
    await queue.enqueue(id)
    await queue.idle()

    const after = (await repository.getRequest(id))!
    expect(after.fileName).toBe('replacement.stl')
    expect(after.modelVolumeMm3).toBeGreaterThan(before.modelVolumeMm3! * 2)
    expect(after.thumbnailPath).not.toBe(before.thumbnailPath)
    expect(await assets.exists(after.thumbnailPath!)).toBe(true)
    expect(await assets.exists(before.thumbnailPath!)).toBe(false)
    expect(await repository.requestsNeedingAssets()).toHaveLength(0)
  })

  it('settles geometry analysis when mesh volume is unavailable', async () => {
    const id = await requestWithFile()
    await queue.enqueue(id)
    await queue.idle()

    expect(await repository.assetGenerationJobs(id)).toContainEqual(
      expect.objectContaining({ stage: 'geometry', status: 'skipped', error: expect.stringContaining('volume') }),
    )
    expect(await repository.assetGenerationCandidates(undefined, 100)).toEqual([])
  })

  it('fails truncated STL input without reporting it to error tracking', async () => {
    const exception = vi.fn(async () => undefined)
    queue = new AssetGenerationQueue(repository, assets, events, { capture: async () => undefined, exception })
    const whole = triangleStl()
    const id = await requestWithFile(whole.slice(0, whole.length - 25))

    await queue.enqueue(id)
    await queue.idle()

    expect(exception).not.toHaveBeenCalled()
    const jobs = await repository.assetGenerationJobs(id)
    expect(jobs.length).toBeGreaterThan(0)
    expect(jobs.every((job) => job.status === 'failed')).toBe(true)
  })

  it('reassigns automatically assigned models after measuring their dimensions', async () => {
    await repository.replacePrinterProfiles([
      { id: 'small', name: 'Small', printType: 'resin', widthMm: 100, depthMm: 100, heightMm: 100 },
      { id: 'large', name: 'Large', printType: 'resin', widthMm: 200, depthMm: 200, heightMm: 200 },
    ])
    const id = await requestWithFile(triangleStl(150, 80, 120))
    await repository.updateRequest(id, { printerId: 'small', requestedPrintType: null, automaticPrinterAssignment: true })

    await queue.enqueue(id)
    await queue.idle()

    expect(await repository.getRequest(id)).toMatchObject({
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
    await queue.enqueue(id)
    expect(queue.stats().visual.queued + queue.stats().visual.running).toBe(1)
    await queue.idle()
  })

  it('processes multiple jobs concurrently', async () => {
    queue = new AssetGenerationQueue(repository, assets, events, telemetry, { concurrency: 2 })
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

    await queue.enqueue(firstId)
    await queue.enqueue(secondId)
    await bothStarted
    expect(queue.stats().visual).toEqual({ queued: 0, running: 2, concurrency: 2 })
    releaseReads()
    await queue.idle()
  })

  it('drains running jobs and leaves queued jobs pending during shutdown', async () => {
    queue = new AssetGenerationQueue(repository, assets, events, telemetry, { concurrency: 1 })
    const firstId = await requestWithFile()
    const secondId = await requestWithFile()
    const originalRead = assets.read.bind(assets)
    let releaseFirst!: () => void
    const firstReleased = new Promise<void>((resolve) => (releaseFirst = resolve))
    let reads = 0
    vi.spyOn(assets, 'read').mockImplementation(async (key) => {
      reads++
      if (reads === 1) await firstReleased
      return await originalRead(key)
    })

    await queue.enqueue(firstId)
    await queue.enqueue(secondId)
    const shutdown = queue.shutdown()
    releaseFirst()
    await shutdown

    expect(reads).toBe(1)
    expect(await repository.requestsNeedingAssets()).toContain(secondId)
  })

  it('skips remotely claimed jobs without occupying worker capacity', async () => {
    const firstId = await requestWithFile()
    const secondId = await requestWithFile()
    const secondPath = (await repository.getRequest(secondId))!.filePath
    const read = vi.spyOn(assets, 'read')
    const stat = vi.spyOn(assets, 'stat')
    const locker = {
      newLock: (id: string) => ({
        lock: vi.fn(),
        tryLock: vi.fn(async () => !id.endsWith(firstId)),
        unlock: vi.fn(),
      }),
    }
    queue = new AssetGenerationQueue(repository, assets, events, telemetry, {
      concurrency: 1,
      sourceByteBudget: triangleStl().byteLength * 12,
      workLocker: locker,
    })

    await queue.enqueue(firstId)
    await queue.enqueue(secondId)
    await queue.idle()

    expect(read).toHaveBeenCalledWith(secondPath)
    expect(stat).not.toHaveBeenCalledWith((await repository.getRequest(firstId))!.filePath)
    expect(await repository.requestsNeedingAssets()).toContain(firstId)
  })

  it('requeues a running job when its distributed lock is lost', async () => {
    const id = await requestWithFile()
    let loseLock!: () => void
    const locker = {
      newLock: () => ({
        lock: vi.fn(),
        tryLock: vi.fn(async (_signal: AbortSignal, requestRelease: () => void) => {
          loseLock = requestRelease
          return true
        }),
        unlock: vi.fn(),
      }),
    }
    let releaseRead!: () => void
    let markReadStarted!: () => void
    const readStarted = new Promise<void>((resolve) => (markReadStarted = resolve))
    const readReleased = new Promise<void>((resolve) => (releaseRead = resolve))
    const originalRead = assets.read.bind(assets)
    vi.spyOn(assets, 'read').mockImplementation(async (key) => {
      markReadStarted()
      await readReleased
      return await originalRead(key)
    })
    queue = new AssetGenerationQueue(repository, assets, events, telemetry, { workLocker: locker })

    await queue.enqueue(id)
    await readStarted
    loseLock()
    releaseRead()
    await queue.idle()

    expect((await repository.assetGenerationJobs(id)).every((job) => job.status === 'pending')).toBe(true)
  })

  it('does not start asset work while another replica migrates storage', async () => {
    const id = await requestWithFile()
    const read = vi.spyOn(assets, 'read')
    const locker = {
      newLock: () => ({ lock: vi.fn(), tryLock: vi.fn(async () => true), unlock: vi.fn() }),
    }
    queue = new AssetGenerationQueue(repository, assets, events, telemetry, {
      workLocker: locker,
      currentStorage: async () => false,
    })

    await queue.enqueue(id)
    await queue.idle()

    expect(read).not.toHaveBeenCalled()
  })

  it('serializes jobs that each consume the source byte budget', async () => {
    queue = new AssetGenerationQueue(repository, assets, events, telemetry, {
      concurrency: 2,
      sourceByteBudget: triangleStl().byteLength * 4,
    })
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

    await queue.enqueue(firstId)
    await queue.enqueue(secondId)
    await vi.waitFor(() => expect(startedReads).toBe(1))
    releaseFirst()
    await queue.idle()

    expect(startedReads).toBe(2)
  })

  it('runs smaller queued sources before larger ones', async () => {
    const file = triangleStl()
    queue = new AssetGenerationQueue(repository, assets, events, telemetry, {
      concurrency: 1,
      sourceByteBudget: file.byteLength * 12,
    })
    const firstId = await requestWithFile(file)
    const secondId = await requestWithFile(file)
    const thirdId = await requestWithFile(file)
    const firstPath = (await repository.getRequest(firstId))!.filePath
    const secondPath = (await repository.getRequest(secondId))!.filePath
    const thirdPath = (await repository.getRequest(thirdId))!.filePath
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

    await queue.enqueue(firstId)
    await queue.enqueue(secondId)
    await queue.enqueue(thirdId)
    await vi.waitFor(() => expect(startedReads).toEqual([firstPath]))
    await vi.waitFor(() => expect(stat).toHaveBeenCalledTimes(3))
    releaseFirst()
    await vi.waitFor(() => expect(startedReads.length).toBeGreaterThanOrEqual(2))

    expect(startedReads[1]).toBe(thirdPath)
    await queue.idle()
  })

  it('runs small jobs concurrently within the source byte budget', async () => {
    const fileBytes = triangleStl().byteLength
    queue = new AssetGenerationQueue(repository, assets, events, telemetry, {
      concurrency: 2,
      sourceByteBudget: fileBytes * 8,
    })
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

    await queue.enqueue(firstId)
    await queue.enqueue(secondId)
    await bothStarted
    releaseReads()
    await queue.idle()

    expect(startedReads).toBe(2)
  })

  it('rejects sources that exceed the generation memory budget', async () => {
    const file = triangleStl()
    queue = new AssetGenerationQueue(repository, assets, events, telemetry, {
      concurrency: 2,
      sourceByteBudget: file.byteLength * 2,
    })
    const id = await requestWithFile(file)
    const read = vi.spyOn(assets, 'read')

    await queue.enqueue(id)
    await queue.idle()

    expect(read).not.toHaveBeenCalled()
    expect(await repository.assetGenerationJobs(id)).toEqual([
      expect.objectContaining({ stage: 'geometry', status: 'failed', error: expect.stringContaining('generation limit') }),
      expect.objectContaining({ stage: 'preview', status: 'failed', error: expect.stringContaining('generation limit') }),
      expect.objectContaining({ stage: 'thumbnail', status: 'failed', error: expect.stringContaining('generation limit') }),
    ])
  })

  it('generates assets at the upload size limit', async () => {
    const id = await requestWithFile()
    vi.spyOn(assets, 'stat').mockResolvedValue({ size: MAX_UPLOAD_BYTES })

    await queue.enqueue(id)
    await queue.idle()

    expect((await repository.getRequest(id))!.hasThumbnail).toBe(true)
  })

  it('preserves a completed thumbnail when preview work is interrupted', async () => {
    const id = await requestWithFile()
    await repository.startAssetGeneration(id, ['thumbnail', 'preview'])
    await repository.finishAssetGeneration(id, 'thumbnail', { status: 'ready', path: 'thumbnails/model.png' })

    const restarted = new AssetGenerationQueue(repository, assets, events, telemetry)
    await restarted.backfill()
    await restarted.idle()
    expect(await repository.assetGenerationJobs(id)).toEqual([
      expect.objectContaining({ stage: 'geometry', status: 'skipped' }),
      expect.objectContaining({ stage: 'preview', status: 'skipped' }),
      expect.objectContaining({ stage: 'thumbnail', status: 'ready' }),
    ])
  })

  it('retries after a transient storage read failure', async () => {
    const id = await requestWithFile()
    vi.spyOn(assets, 'read').mockRejectedValueOnce(new Error('storage offline'))
    await queue.enqueue(id)
    await queue.idle()
    expect(await repository.requestsNeedingAssets()).toEqual([id])
    await queue.enqueue(id)
    await queue.idle()
    expect((await repository.getRequest(id))!.hasThumbnail).toBe(true)
  })
})
