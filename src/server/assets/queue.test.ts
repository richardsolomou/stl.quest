import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { build } from 'esbuild'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalAssetStore } from '../../adapters/filesystem'
import { LocalEventBus } from '../../adapters/events'
import { SqliteRepository } from '../../adapters/sqlite'
import { createDatabase } from '../../db'
import { user } from '../../db/schema'
import type { AppEvent, Telemetry } from '../../core/types'
import { ORIENTATION_ANALYSIS_VERSION } from '../../core/platePlanner'
import { AssetGenerationQueue } from './queue'
import { exportBinaryStl } from '../../core/mesh/stl'
import { thumbnailKey } from '../../core/assetKeys'

const telemetry: Telemetry = { capture: async () => undefined, exception: async () => undefined }

function triangleStl(): Uint8Array {
  const positions = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0])
  return exportBinaryStl(positions, new Uint32Array([0, 1, 2]))
}

function tetrahedronStl(scale = 10): Uint8Array {
  const positions = new Float32Array([
    0,
    0,
    0,
    0,
    scale,
    0,
    scale,
    0,
    0,
    0,
    0,
    0,
    scale,
    0,
    0,
    0,
    0,
    scale,
    0,
    0,
    0,
    0,
    0,
    scale,
    0,
    scale,
    0,
    scale,
    0,
    0,
    0,
    scale,
    0,
    0,
    0,
    scale,
  ])
  return exportBinaryStl(positions, new Uint32Array(Array.from({ length: 12 }, (_, index) => index)))
}

describe('asset generation queue', () => {
  let root: string
  let repository: SqliteRepository
  let assets: LocalAssetStore
  let events: LocalEventBus
  let queue: AssetGenerationQueue

  beforeEach(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-assets-'))
    repository = new SqliteRepository(createDatabase(':memory:'))
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

  async function requestWithFile(file: Uint8Array = triangleStl(), requestedPrintType: 'resin' | 'filament' = 'resin') {
    await assets.write('todo/model.stl', file)
    return repository.createRequest({
      name: 'Model',
      fileName: 'model.stl',
      filePath: 'todo/model.stl',
      quantity: 1,
      ownerUserId: 'owner',
      requestedPrintType,
    })
  }

  async function workerScript(name: string, source: string) {
    const workerPath = path.join(root, name)
    await fs.promises.writeFile(workerPath, source)
    return workerPath
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

  it('removes derived assets when a request is deleted during generation', async () => {
    const id = await requestWithFile()
    const thumbnailPath = thumbnailKey('todo/model.stl', 'image/png')
    let releaseWrite!: () => void
    const writeReleased = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    let markWriteStarted!: () => void
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve
    })
    const write = assets.write.bind(assets)
    vi.spyOn(assets, 'write').mockImplementation(async (assetPath, contents) => {
      if (assetPath === thumbnailPath) {
        markWriteStarted()
        await writeReleased
      }
      return write(assetPath, contents)
    })

    queue.enqueue(id)
    await writeStarted
    repository.deleteRequest(id)
    releaseWrite()
    await queue.idle()

    expect(repository.getRequest(id)).toBeUndefined()
    expect(repository.getPlateModelAnalysis(id)).toBeUndefined()
    expect(await assets.exists(thumbnailPath)).toBe(false)
    expect(await assets.exists(assets.previewPath('todo/model.stl'))).toBe(false)
  })

  it('removes a generated asset when an active delete operation wins the commit race', async () => {
    const id = await requestWithFile()
    const thumbnailPath = thumbnailKey('todo/model.stl', 'image/png')
    const operationId = crypto.randomUUID()
    const write = assets.write.bind(assets)
    vi.spyOn(assets, 'write').mockImplementation(async (assetPath, contents) => {
      await write(assetPath, contents)
      if (assetPath === thumbnailPath) {
        repository.beginOperation(operationId, {
          kind: 'delete',
          requestId: id,
          ownerUserId: 'owner',
          assets: [{ originalPath: 'todo/model.stl', trashPath: assets.trashPath(operationId, 'todo/model.stl') }],
        })
      }
    })

    queue.enqueue(id)
    await queue.idle()

    expect(repository.getRequest(id)?.thumbnailPath).toBeUndefined()
    expect(await assets.exists(thumbnailPath)).toBe(false)
  })

  it('reports queue depth and worker mode for health checks', async () => {
    const id = await requestWithFile()
    expect(queue.stats()).toEqual({
      queued: 0,
      pending: 0,
      concurrency: 8,
      worker: false,
      visual: { queued: 0, running: 0, concurrency: 8 },
      orientation: { queued: 0, running: 0, concurrency: 8 },
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
    expect(queue.stats().orientation).toMatchObject({ queued: 0, running: 2, concurrency: 2 })
    releaseReads()
    await queue.idle()
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
    const originalWrite = assets.write.bind(assets)
    vi.spyOn(assets, 'write').mockImplementation(async (key, bytes) => {
      if (key.endsWith('.png')) await new Promise((resolve) => setTimeout(resolve, 25))
      return originalWrite(key, bytes)
    })
    expect(isolated.stats().worker).toBe(true)
    isolated.enqueue(id)
    await isolated.idle()
    expect(repository.getRequest(id)?.hasThumbnail).toBe(true)
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

  it('uses the complete original geometry for orientation analysis when a preview exists', async () => {
    const id = await requestWithFile(tetrahedronStl(20))
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

    expect(reads).not.toContain(previewPath)
    expect(repository.getPlateModelAnalysis(id)).toMatchObject({
      widthMm: 20,
      depthMm: 20,
      heightMm: 20,
      estimatedVolumeMm3: 4_000 / 3,
    })
    expect(repository.getPlateModelAnalysis(id)?.orientationCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          widthMm: expect.any(Number),
          depthMm: expect.any(Number),
          heightMm: expect.any(Number),
        }),
      ]),
    )
    expect(
      repository
        .getPlateModelAnalysis(id)!
        .orientationCandidates!.every((candidate) => Math.max(candidate.widthMm, candidate.depthMm, candidate.heightMm) > 15),
    ).toBe(true)
    expect(repository.listOrientationAnalysisJobs()).toEqual([expect.objectContaining({ requestId: id, status: 'ready' })])
  })

  it('stores filament mesh facts without resin orientation candidates', async () => {
    const id = await requestWithFile(tetrahedronStl(20), 'filament')
    expect(repository.getRequest(id)?.requestedPrintType).toBe('filament')
    queue.enqueue(id)
    await queue.idle()
    expect(repository.getPlateModelAnalysis(id)).toMatchObject({
      widthMm: 20,
      depthMm: 20,
      heightMm: 20,
      estimatedVolumeMm3: 4_000 / 3,
      orientationCandidates: undefined,
    })
    expect(repository.listOrientationAnalysisJobs()).toEqual([expect.objectContaining({ requestId: id, status: 'ready' })])
  })

  it('adds resin orientation candidates when an analyzed filament request changes print type', async () => {
    const id = await requestWithFile(tetrahedronStl(20), 'filament')
    queue.enqueue(id)
    await queue.idle()

    repository.updateRequest(id, { requestedPrintType: 'resin' })
    expect(repository.requestsNeedingOrientationAnalysis(ORIENTATION_ANALYSIS_VERSION)).toEqual([id])
    queue.backfill()
    await queue.idle()

    expect(repository.getPlateModelAnalysis(id)?.orientationCandidates).toEqual(
      expect.arrayContaining([expect.objectContaining({ quaternion: expect.any(Array) })]),
    )
    expect(repository.requestsNeedingOrientationAnalysis(ORIENTATION_ANALYSIS_VERSION)).toEqual([])
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
      expect.objectContaining({
        requestId: id,
        status: expect.stringMatching(/^(pending|running)$/),
        analysisVersion: ORIENTATION_ANALYSIS_VERSION,
      }),
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

  it('waits for an in-flight thumbnail write before failing preview work', async () => {
    const workerPath = await workerScript(
      'thumbnail-then-error.mjs',
      `import { parentPort, workerData } from 'node:worker_threads'
if (workerData.mode === 'visual') {
  parentPort.postMessage({ ok: true, stage: 'thumbnail', thumbnailPng: new Uint8Array([1, 2, 3]) })
  parentPort.postMessage({ ok: false, message: 'preview failed' })
} else {
  parentPort.postMessage({ ok: false, message: 'analysis failed' })
}`,
    )
    queue = new AssetGenerationQueue(repository, assets, events, telemetry, 1, { path: workerPath })
    const id = await requestWithFile()
    const originalWrite = assets.write.bind(assets)
    let releaseWrite!: () => void
    let markWriteStarted!: () => void
    const writeStarted = new Promise<void>((resolve) => (markWriteStarted = resolve))
    const writeReleased = new Promise<void>((resolve) => (releaseWrite = resolve))
    vi.spyOn(assets, 'write').mockImplementation(async (key, data) => {
      if (key.includes('/thumbnails/')) {
        markWriteStarted()
        await writeReleased
      }
      return originalWrite(key, data)
    })

    queue.enqueue(id)
    let idleSettled = false
    const idle = queue.idle().then(() => (idleSettled = true))
    await writeStarted
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(idleSettled).toBe(false)

    releaseWrite()
    await idle
    expect(repository.assetGenerationJobs(id)).toEqual([
      expect.objectContaining({ stage: 'preview', status: 'failed', error: 'preview failed' }),
      expect.objectContaining({ stage: 'thumbnail', status: 'ready' }),
    ])
  })

  it.each([
    [
      'worker error',
      "parentPort.postMessage({ ok: false, message: 'preview failed' })",
      'thumbnail storage exceeded its execution deadline',
      500,
    ],
    ['worker timeout', 'setInterval(() => undefined, 1_000)', 'visual asset worker exceeded its execution deadline', 20],
  ])('settles a %s without waiting forever for thumbnail storage', async (name, workerEnding, expectedError, workerTimeoutMs) => {
    const workerPath = await workerScript(
      `thumbnail-never-stores-${name.replace(' ', '-')}.mjs`,
      `import { parentPort } from 'node:worker_threads'
parentPort.postMessage({ ok: true, stage: 'thumbnail', thumbnailPng: new Uint8Array([1, 2, 3]) })
${workerEnding}`,
    )
    queue = new AssetGenerationQueue(repository, assets, events, telemetry, 1, { path: workerPath }, workerTimeoutMs, 5)
    const originalWrite = assets.write.bind(assets)
    vi.spyOn(assets, 'write').mockImplementation((key, contents) => {
      if (key.includes('/thumbnails/')) return new Promise<void>(() => undefined)
      return originalWrite(key, contents)
    })
    const id = await requestWithFile()

    queue.enqueue(id)
    await expect(
      Promise.race([queue.idle(), new Promise((_, reject) => setTimeout(() => reject(new Error('queue hung')), 500))]),
    ).resolves.toBe(undefined)

    expect(repository.assetGenerationJobs(id)).toEqual([
      expect.objectContaining({ stage: 'preview', status: 'failed', error: expectedError }),
      expect.objectContaining({ stage: 'thumbnail', status: 'failed', error: expectedError }),
    ])
  })

  it('fails when a worker exits cleanly before replying', async () => {
    const workerPath = await workerScript('clean-exit.mjs', '')
    queue = new AssetGenerationQueue(repository, assets, events, telemetry, 1, { path: workerPath })
    const id = await requestWithFile()

    queue.enqueueAnalysis(id)
    await queue.idle()

    expect(repository.listOrientationAnalysisJobs()).toEqual([
      expect.objectContaining({ requestId: id, status: 'failed', error: 'asset worker exited with code 0' }),
    ])
    expect(queue.stats().orientation).toEqual({ queued: 0, running: 0, concurrency: 1 })
  })

  it('terminates visual and orientation workers at their execution deadlines', async () => {
    const workerPath = await workerScript('deadline.mjs', 'setInterval(() => undefined, 1_000)')
    queue = new AssetGenerationQueue(repository, assets, events, telemetry, 1, { path: workerPath }, 20)
    const terminate = vi.spyOn(Worker.prototype, 'terminate')
    const id = await requestWithFile()

    queue.enqueue(id)
    await queue.idle()

    expect(terminate).toHaveBeenCalledTimes(2)
    expect(repository.assetGenerationJobs(id)).toEqual([
      expect.objectContaining({ stage: 'preview', status: 'failed', error: 'visual asset worker exceeded its execution deadline' }),
      expect.objectContaining({ stage: 'thumbnail', status: 'failed', error: 'visual asset worker exceeded its execution deadline' }),
    ])
    expect(repository.listOrientationAnalysisJobs()).toEqual([
      expect.objectContaining({
        requestId: id,
        status: 'failed',
        error: 'orientation asset worker exceeded its execution deadline',
      }),
    ])
  })

  it('leaves the request unstamped when storage cannot be read, so the next boot retries', async () => {
    const id = await requestWithFile()
    vi.spyOn(assets, 'read').mockRejectedValueOnce(new Error('storage offline')).mockRejectedValueOnce(new Error('storage offline'))
    queue.enqueue(id)
    await queue.idle()
    expect(repository.requestsNeedingAssets()).toEqual([id])
    expect(repository.requestsNeedingOrientationAnalysis(ORIENTATION_ANALYSIS_VERSION)).toEqual([id])
    expect(repository.listOrientationAnalysisJobs()).toEqual([expect.objectContaining({ requestId: id, status: 'pending' })])
    queue.backfill()
    await queue.idle()
    expect(repository.getRequest(id)!.hasThumbnail).toBe(true)
    expect(repository.listOrientationAnalysisJobs()).toEqual([expect.objectContaining({ requestId: id, status: 'ready' })])
  })
})
