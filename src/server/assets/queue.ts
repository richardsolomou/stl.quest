import fs from 'node:fs'
import crypto from 'node:crypto'
import { setImmediate } from 'node:timers/promises'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import PQueue from 'p-queue'
import type { AssetStore, EventBus, Repository, Telemetry } from '../../core/types'
import { thumbnailKey } from '../../core/assetKeys'
import type { PlateModelAnalysis } from '../../core/platePlanner'
import { generateAssets, generateVisualAssets, type GeneratedAssets } from './pipeline'
import { logger } from '../logger'
import { assetJobDuration, assetJobs, assetQueueDepth } from '../metrics'

type WorkerConfig = { path: string; execArgv?: string[] }

// Heavy mesh work always runs outside the request event loop. Production uses
// the bundled worker; development executes the TypeScript source via tsx.
// Tests stay inline so failures and assertions remain deterministic.
function resolveWorkerConfig(): WorkerConfig | undefined {
  if (process.env.VITEST) return undefined
  if (import.meta.env?.DEV) {
    return { path: fileURLToPath(new URL('./worker.ts', import.meta.url)), execArgv: ['--import', 'tsx'] }
  }
  if (!import.meta.env?.PROD) return undefined
  for (const candidate of ['../assets-worker.mjs', './assets-worker.mjs', '../../assets-worker.mjs']) {
    try {
      const resolved = fileURLToPath(new URL(candidate, import.meta.url))
      if (fs.existsSync(resolved)) return { path: resolved }
    } catch {}
  }
  logger.warn('assets worker not found next to server bundle; generating assets in-process')
  return undefined
}

export const ORIENTATION_ANALYSIS_VERSION = 6

export class AssetGenerationQueue {
  private visualQueue: PQueue
  private orientationQueue: PQueue
  private visualQueued = new Set<string>()
  private orientationQueued = new Set<string>()
  private workerConfig = resolveWorkerConfig()
  private updateTimer: ReturnType<typeof setTimeout> | undefined
  private updateDone: Promise<void> | undefined
  private resolveUpdate: (() => void) | undefined

  constructor(
    private repository: Repository,
    private assets: AssetStore,
    private events: EventBus,
    private telemetry: Telemetry,
    concurrency = assetConcurrency(),
    workerConfig = resolveWorkerConfig(),
  ) {
    this.visualQueue = new PQueue({ concurrency })
    this.orientationQueue = new PQueue({ concurrency })
    this.workerConfig = workerConfig
    this.repository.requeueInterruptedAssetGeneration()
  }

  enqueue(requestId: string) {
    this.repository.queueAssetGeneration(requestId)
    this.repository.queueOrientationAnalysis(requestId, ORIENTATION_ANALYSIS_VERSION)
    this.enqueueVisual(requestId)
    this.enqueueOrientation(requestId)
    this.updateMetrics()
  }

  /** Queue every request never stamped as processed — new uploads from a crash, imported boards, interrupted jobs. */
  backfill() {
    const requestIds = new Set([
      ...this.repository.requestsNeedingAssets(),
      ...this.repository.requestsNeedingOrientationAnalysis(ORIENTATION_ANALYSIS_VERSION),
    ])
    for (const id of requestIds) this.enqueue(id)
  }

  /** Resolves once everything currently queued has finished; for tests and shutdown. */
  async idle() {
    await Promise.all([this.visualQueue.onIdle(), this.orientationQueue.onIdle()])
    await this.updateDone
  }

  async shutdown() {
    this.visualQueue.pause()
    this.orientationQueue.pause()
    await Promise.all([this.visualQueue.onPendingZero(), this.orientationQueue.onPendingZero()])
    await this.updateDone
  }

  stats() {
    return {
      queued: this.visualQueue.size + this.orientationQueue.size,
      pending: this.visualQueue.pending + this.orientationQueue.pending,
      concurrency: this.visualQueue.concurrency,
      worker: !!this.workerConfig,
      visual: { queued: this.visualQueue.size, running: this.visualQueue.pending, concurrency: this.visualQueue.concurrency },
      orientation: {
        queued: this.orientationQueue.size,
        running: this.orientationQueue.pending,
        concurrency: this.orientationQueue.concurrency,
      },
    }
  }

  private updateMetrics() {
    assetQueueDepth.set({ state: 'queued' }, this.visualQueue.size + this.orientationQueue.size)
    assetQueueDepth.set({ state: 'running' }, this.visualQueue.pending + this.orientationQueue.pending)
  }

  private enqueueVisual(requestId: string) {
    if (this.visualQueued.has(requestId)) return
    this.visualQueued.add(requestId)
    void this.visualQueue
      .add(() => this.processVisual(requestId), { priority: 10 })
      .catch((error) => logger.error({ err: error, requestId }, 'visual asset queue job failed'))
      .finally(() => {
        this.visualQueued.delete(requestId)
        this.updateMetrics()
      })
  }

  private enqueueOrientation(requestId: string) {
    if (this.orientationQueued.has(requestId)) return
    this.orientationQueued.add(requestId)
    void this.orientationQueue
      .add(() => this.processOrientation(requestId))
      .catch((error) => logger.error({ err: error, requestId }, 'orientation queue job failed'))
      .finally(() => {
        this.orientationQueued.delete(requestId)
        this.updateMetrics()
      })
  }

  private async processVisual(requestId: string) {
    const startedAt = performance.now()
    const log = logger.child({ requestId })
    const request = this.repository.getRequest(requestId)
    if (!request) return
    const jobs = this.repository.assetGenerationJobs(requestId)
    const wants = {
      thumbnail: jobs.some((job) => job.stage === 'thumbnail' && job.status === 'pending'),
      preview: jobs.some((job) => job.stage === 'preview' && job.status === 'pending'),
    }
    if (!wants.thumbnail && !wants.preview) return
    this.repository.startAssetGeneration(
      requestId,
      [wants.thumbnail ? 'thumbnail' : undefined, wants.preview ? 'preview' : undefined].filter(Boolean) as ('thumbnail' | 'preview')[],
    )
    this.publishUpdate()

    let file: Uint8Array
    try {
      file = await readAll(await this.assets.read(request.filePath))
    } catch (error) {
      // Storage trouble is transient: leave the request unstamped so the next
      // boot's backfill retries it.
      void this.telemetry.exception(error, { action: 'assets_read', request_id: requestId }).catch(() => undefined)
      log.warn({ err: error }, 'asset source read failed')
      this.repository.requeueAssetGeneration(
        requestId,
        (['thumbnail', 'preview'] as const).filter((stage) => wants[stage]),
      )
      this.publishUpdate()
      assetJobs.inc({ outcome: 'read_error' })
      assetJobDuration.observe({ outcome: 'read_error' }, (performance.now() - startedAt) / 1000)
      return
    }

    await setImmediate()
    try {
      const generated = await this.runVisualPipeline(file, wants, async (thumbnailPng) => {
        const thumbnailPath = thumbnailKey(request.filePath, 'image/png')
        try {
          await this.assets.write(thumbnailPath, thumbnailPng)
        } catch (error) {
          throw new AssetWriteError(error)
        }
        this.repository.finishAssetGeneration(requestId, 'thumbnail', { status: 'ready', path: thumbnailPath })
        this.publishUpdate()
      })
      if (wants.preview) {
        if (generated.previewStl) {
          const previewPath = this.assets.previewPath(request.filePath)
          try {
            await this.assets.write(previewPath, generated.previewStl)
          } catch (error) {
            throw new AssetWriteError(error)
          }
          this.repository.finishAssetGeneration(requestId, 'preview', { status: 'ready', path: previewPath })
        } else {
          this.repository.finishAssetGeneration(requestId, 'preview', { status: 'skipped' })
        }
      }
      this.publishUpdate()
      log.info({ durationMs: Math.round(performance.now() - startedAt), ...wants }, 'visual asset generation completed')
      assetJobs.inc({ outcome: 'success' })
      assetJobDuration.observe({ outcome: 'success' }, (performance.now() - startedAt) / 1000)
    } catch (error) {
      const current = this.repository.assetGenerationJobs(requestId)
      const running = (['thumbnail', 'preview'] as const).filter((stage) =>
        current.some((job) => job.stage === stage && job.status === 'running'),
      )
      if (error instanceof AssetWriteError) {
        void this.telemetry.exception(error.cause, { action: 'assets_write', request_id: requestId }).catch(() => undefined)
        log.warn({ err: error.cause }, 'generated asset write failed')
        this.repository.requeueAssetGeneration(requestId, running)
        assetJobs.inc({ outcome: 'write_error' })
        assetJobDuration.observe({ outcome: 'write_error' }, (performance.now() - startedAt) / 1000)
      } else {
        void this.telemetry.exception(error, { action: 'assets_generate', request_id: requestId }).catch(() => undefined)
        log.warn({ err: error }, 'visual asset generation failed')
        for (const stage of running)
          this.repository.finishAssetGeneration(requestId, stage, { status: 'failed', error: errorMessage(error) })
        assetJobs.inc({ outcome: 'invalid_model' })
        assetJobDuration.observe({ outcome: 'invalid_model' }, (performance.now() - startedAt) / 1000)
      }
      this.publishUpdate()
    }
  }

  private async processOrientation(requestId: string) {
    await this.visualQueue.onIdle()
    const request = this.repository.getRequest(requestId)
    if (!request) return
    const existingAnalysis = this.repository.getPlateModelAnalysis(requestId)
    if (existingAnalysis?.analysisVersion === ORIENTATION_ANALYSIS_VERSION && existingAnalysis.orientationCandidates?.length) return
    this.repository.startOrientationAnalysis(requestId, ORIENTATION_ANALYSIS_VERSION)
    this.publishUpdate()
    try {
      const sourceFile = await readAll(await this.assets.read(request.filePath))
      const contentHash = crypto.createHash('sha256').update(sourceFile).digest('hex')
      const sharedAnalysis = this.repository.findPlateModelAnalysisByContentHash(contentHash, ORIENTATION_ANALYSIS_VERSION)
      const analysisFile = request.previewPath ? await readAll(await this.assets.read(request.previewPath)) : sourceFile
      const generated = sharedAnalysis
        ? undefined
        : await this.runPipeline(analysisFile, { thumbnail: false, preview: false, orientation: true })
      const orientationCandidates = sharedAnalysis?.orientationCandidates ?? generated?.orientationCandidates
      if (orientationCandidates?.length) {
        const selected = orientationCandidates[0]
        const analysis: PlateModelAnalysis = {
          requestId,
          contentHash,
          analysisVersion: ORIENTATION_ANALYSIS_VERSION,
          widthMm: selected.widthMm,
          depthMm: selected.depthMm,
          heightMm: selected.heightMm,
          orientationQuaternion: selected.quaternion,
          orientationIslandCount: selected.islandCount,
          orientationRisk: selected.islandRisk,
          orientationCandidates,
        }
        this.repository.upsertPlateModelAnalyses([analysis])
      } else {
        throw new Error('orientation analysis returned no candidates')
      }
      this.publishUpdate()
    } catch (error) {
      this.repository.failOrientationAnalysis(requestId, ORIENTATION_ANALYSIS_VERSION, errorMessage(error))
      this.publishUpdate()
    }
  }

  private runVisualPipeline(
    file: Uint8Array,
    wants: { thumbnail: boolean; preview: boolean },
    thumbnailReady: (thumbnail: Uint8Array) => void | Promise<void>,
  ): Promise<{ previewStl?: Uint8Array }> {
    if (!this.workerConfig) return generateVisualAssets(file, wants, thumbnailReady)
    return new Promise((resolve, reject) => {
      const worker = new Worker(this.workerConfig!.path, {
        workerData: { file, wants, mode: 'visual' },
        transferList: [file.buffer as ArrayBuffer],
        execArgv: this.workerConfig!.execArgv,
      })
      let thumbnailWrite = Promise.resolve()
      worker.on(
        'message',
        (
          reply:
            | { ok: true; stage: 'thumbnail'; thumbnailPng: Uint8Array }
            | ({ ok: true; stage: 'complete' } & GeneratedAssets)
            | { ok: false; message: string },
        ) => {
          if (!reply.ok) return reject(new Error(reply.message))
          if (reply.stage === 'thumbnail') thumbnailWrite = thumbnailWrite.then(() => thumbnailReady(reply.thumbnailPng))
          else void thumbnailWrite.then(() => resolve({ previewStl: reply.previewStl }), reject)
        },
      )
      worker.once('error', reject)
      worker.once('exit', (code) => {
        if (code !== 0) reject(new Error(`asset worker exited with code ${code}`))
      })
    })
  }

  private runPipeline(file: Uint8Array, wants: { thumbnail: boolean; preview: boolean; orientation: boolean }): Promise<GeneratedAssets> {
    if (!this.workerConfig) return generateAssets(file, wants)
    return new Promise((resolve, reject) => {
      const worker = new Worker(this.workerConfig!.path, {
        workerData: { file, wants },
        transferList: [file.buffer as ArrayBuffer],
        execArgv: this.workerConfig!.execArgv,
      })
      let settled = false
      const settle = (action: () => void) => {
        if (settled) return
        settled = true
        action()
        void worker.terminate()
      }
      worker.once('message', (reply: ({ ok: true } & GeneratedAssets) | { ok: false; message: string }) => {
        settle(() => (reply.ok ? resolve(reply) : reject(new Error(reply.message))))
      })
      worker.once('error', (error) => settle(() => reject(error)))
      worker.once('exit', (code) => settle(() => reject(new Error(`asset worker exited with code ${code}`))))
    })
  }

  private publishUpdate() {
    if (this.updateTimer) return
    this.updateDone = new Promise((resolve) => {
      this.resolveUpdate = resolve
    })
    this.updateTimer = setTimeout(() => {
      this.updateTimer = undefined
      this.events.publish('request.updated')
      this.resolveUpdate?.()
      this.resolveUpdate = undefined
      this.updateDone = undefined
    }, 150)
  }
}

function assetConcurrency() {
  const configured = Number.parseInt(process.env.ASSET_JOB_CONCURRENCY ?? '', 10)
  if (Number.isFinite(configured) && configured > 0) return configured
  return 1
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

class AssetWriteError extends Error {
  constructor(readonly cause: unknown) {
    super(errorMessage(cause))
  }
}

async function readAll(asset: { stream: ReadableStream; size: number }): Promise<Uint8Array> {
  let output = new Uint8Array(asset.size)
  let offset = 0
  const reader = (asset.stream as ReadableStream<Uint8Array>).getReader()
  for (let step = await reader.read(); !step.done; step = await reader.read()) {
    if (offset + step.value.length > output.length) {
      const expanded = new Uint8Array(Math.max(offset + step.value.length, output.length * 2))
      expanded.set(output)
      output = expanded
    }
    output.set(step.value, offset)
    offset += step.value.length
  }
  return offset === output.length ? output : output.slice(0, offset)
}
