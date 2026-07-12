import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { build } from 'esbuild'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalAssetStore } from '../../adapters/filesystem'
import { LocalEventBus } from '../../adapters/events'
import { SqliteRepository } from '../../adapters/sqlite'
import type { AppEvent, Telemetry } from '../../core/types'
import { AssetGenerationQueue, ORIENTATION_ANALYSIS_VERSION } from './queue'
import { exportBinaryStl } from '../../core/mesh/stl'

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
    return repository.createRequest({
      name: 'Model',
      fileName: 'model.stl',
      filePath: 'todo/model.stl',
      quantity: 1,
      requesterEmail: 'owner@example.com',
    })
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

  it('reports queue depth and worker mode for health checks', async () => {
    const id = await requestWithFile()
    expect(queue.stats()).toEqual({
      queued: 0,
      pending: 0,
      concurrency: 1,
      worker: false,
      visual: { queued: 0, running: 0, concurrency: 1 },
      orientation: { queued: 0, running: 0, concurrency: 1 },
    })
    queue.enqueue(id)
    expect(queue.stats().visual.queued + queue.stats().visual.running).toBe(1)
    expect(queue.stats().orientation.queued + queue.stats().orientation.running).toBe(1)
    await queue.idle()
    expect(queue.stats()).toMatchObject({
      queued: 0,
      pending: 0,
      visual: { queued: 0, running: 0 },
      orientation: { queued: 0, running: 0 },
    })
  })

  it('processes multiple jobs concurrently when configured', async () => {
    queue = new AssetGenerationQueue(repository, assets, events, telemetry, 2)
    const firstId = await requestWithFile()
    const secondId = await requestWithFile()
    const originalRead = assets.read.bind(assets)
    let startedReads = 0
    let resolveStarted!: () => void
    let releaseReads!: () => void
    const bothStarted = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    const readsReleased = new Promise<void>((resolve) => {
      releaseReads = resolve
    })
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
    expect(queue.stats().orientation).toMatchObject({ queued: 1, running: 1 })
    releaseReads()
    await queue.idle()
  })

  it('caps configured concurrency to protect the server', () => {
    const capped = new AssetGenerationQueue(repository, assets, events, telemetry, 99)
    expect(capped.stats().concurrency).toBe(8)
  })

  it('can execute mesh analysis in the isolated production worker', async () => {
    const workerPath = path.join(root, 'assets-worker.mjs')
    await build({
      entryPoints: [path.resolve('src/server/assets/worker.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node24',
      outfile: workerPath,
      logLevel: 'silent',
    })
    const isolated = new AssetGenerationQueue(repository, assets, events, telemetry, 1, {
      path: workerPath,
    })
    const id = await requestWithFile()
    expect(isolated.stats().worker).toBe(true)
    isolated.enqueue(id)
    await isolated.idle()
    expect(repository.listOrientationAnalysisJobs()).toEqual([expect.objectContaining({ requestId: id, status: 'ready' })])
  })

  it('backfills every unstamped request and skips stamped ones afterwards', async () => {
    const id = await requestWithFile()
    expect(repository.requestsNeedingAssets()).toEqual([id])
    queue.backfill()
    await queue.idle()
    expect(repository.getRequest(id)!.hasThumbnail).toBe(true)
    expect(repository.requestsNeedingAssets()).toHaveLength(0)
  })

  it('backfills orientation analysis for legacy uploads whose visual assets were already generated', async () => {
    const id = await requestWithFile()
    repository.completeAssetGeneration(id, { thumbnailPath: '.printhub/thumbnails/existing.png' })
    expect(repository.requestsNeedingAssets()).toEqual([])
    expect(repository.requestsNeedingOrientationAnalysis(ORIENTATION_ANALYSIS_VERSION)).toEqual([id])
    queue.backfill()
    await queue.idle()
    expect(repository.listOrientationAnalysisJobs()).toEqual([expect.objectContaining({ requestId: id, status: 'ready' })])
    expect(repository.listPlateModelAnalyses()).toEqual([
      expect.objectContaining({ requestId: id, analysisVersion: ORIENTATION_ANALYSIS_VERSION }),
    ])
  })

  it('uses the lightweight preview for orientation analysis when available', async () => {
    const id = await requestWithFile()
    const previewPath = '.printhub/previews/model.stl'
    await assets.write(previewPath, triangleStl())
    repository.completeAssetGeneration(id, { thumbnailPath: '.printhub/thumbnails/model.png', previewPath })
    const reads: string[] = []
    const originalRead = assets.read.bind(assets)
    vi.spyOn(assets, 'read').mockImplementation(async (key) => {
      reads.push(key)
      return originalRead(key)
    })

    queue.backfill()
    await queue.idle()

    expect(reads).toContain(previewPath)
    expect(repository.listOrientationAnalysisJobs()).toEqual([expect.objectContaining({ requestId: id, status: 'ready' })])
  })

  it('stamps an unparseable file as processed so it is not retried forever', async () => {
    const id = await requestWithFile(new TextEncoder().encode('not an stl'))
    queue.enqueue(id)
    await queue.idle()
    expect(repository.getRequest(id)!.hasThumbnail).toBe(false)
    expect(repository.requestsNeedingAssets()).toHaveLength(0)
    expect(repository.listOrientationAnalysisJobs()).toEqual([
      expect.objectContaining({ requestId: id, status: 'failed', analysisVersion: ORIENTATION_ANALYSIS_VERSION }),
    ])
  })

  it('persists ranked orientation candidates and marks the background job ready', async () => {
    const id = await requestWithFile()
    queue.enqueue(id)
    expect(repository.listOrientationAnalysisJobs()).toEqual([
      expect.objectContaining({ requestId: id, status: 'pending', analysisVersion: ORIENTATION_ANALYSIS_VERSION }),
    ])
    await queue.idle()
    expect(repository.listOrientationAnalysisJobs()).toEqual([
      expect.objectContaining({ requestId: id, status: 'ready', analysisVersion: ORIENTATION_ANALYSIS_VERSION }),
    ])
    expect(repository.listPlateModelAnalyses()).toEqual([
      expect.objectContaining({
        requestId: id,
        analysisVersion: ORIENTATION_ANALYSIS_VERSION,
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        orientationCandidates: expect.arrayContaining([expect.objectContaining({ quaternion: expect.any(Array) })]),
      }),
    ])
  })

  it('looks up existing orientation analysis without scanning every model', async () => {
    const id = await requestWithFile()
    const list = vi.spyOn(repository, 'listPlateModelAnalyses')
    queue.enqueue(id)
    await queue.idle()
    expect(list).not.toHaveBeenCalled()
  })

  it('backfills interrupted orientation jobs after restart', async () => {
    const id = await requestWithFile()
    repository.queueOrientationAnalysis(id, ORIENTATION_ANALYSIS_VERSION)
    repository.startOrientationAnalysis(id, ORIENTATION_ANALYSIS_VERSION)
    queue.backfill()
    await queue.idle()
    expect(repository.listOrientationAnalysisJobs()).toEqual([expect.objectContaining({ requestId: id, status: 'ready' })])
  })

  it('preserves a completed thumbnail when preview work is interrupted', async () => {
    const id = await requestWithFile()
    repository.startAssetGeneration(id, ['thumbnail', 'preview'])
    repository.finishAssetGeneration(id, 'thumbnail', { status: 'ready', path: '.printhub/thumbnails/model.png' })

    const restarted = new AssetGenerationQueue(repository, assets, events, telemetry)
    expect(repository.assetGenerationJobs(id)).toEqual([
      expect.objectContaining({ stage: 'preview', status: 'pending' }),
      expect.objectContaining({ stage: 'thumbnail', status: 'ready' }),
    ])
    restarted.backfill()
    await restarted.idle()
    expect(repository.getRequest(id)).toMatchObject({ hasThumbnail: true, previewPath: undefined })
    expect(repository.assetGenerationJobs(id)).toEqual([
      expect.objectContaining({ stage: 'preview', status: 'skipped' }),
      expect.objectContaining({ stage: 'thumbnail', status: 'ready' }),
    ])
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
