import fs from 'node:fs'
import crypto from 'node:crypto'
import { setImmediate } from 'node:timers/promises'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import PQueue from 'p-queue'
import type { AssetStore, EventBus, Repository, Telemetry } from '../../core/types'
import { thumbnailKey } from '../../core/assetKeys'
import type { PlateModelAnalysis } from '../../core/platePlanner'
import { generateAssets, type GeneratedAssets } from './pipeline'
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

export const ORIENTATION_ANALYSIS_VERSION = 5

export class AssetGenerationQueue {
  private queue: PQueue
  private queued = new Set<string>()
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
    this.queue = new PQueue({ concurrency: Math.max(1, Math.min(concurrency, maximumAssetConcurrency())) })
    this.workerConfig = workerConfig
  }

  enqueue(requestId: string) {
    if (this.queued.has(requestId)) return
    this.repository.queueOrientationAnalysis(requestId, ORIENTATION_ANALYSIS_VERSION)
    this.queued.add(requestId)
    void this.queue
      .add(() => this.process(requestId))
      .catch((error) => logger.error({ err: error, requestId }, 'asset queue job failed'))
      .finally(() => {
        this.queued.delete(requestId)
        this.updateMetrics()
      })
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
    await this.queue.onIdle()
    await this.updateDone
  }

  stats() {
    return { queued: this.queue.size, pending: this.queue.pending, concurrency: this.queue.concurrency, worker: !!this.workerConfig }
  }

  private updateMetrics() {
    assetQueueDepth.set({ state: 'queued' }, this.queue.size)
    assetQueueDepth.set({ state: 'running' }, this.queue.pending)
  }

  private async process(requestId: string) {
    const startedAt = performance.now()
    const log = logger.child({ requestId })
    const request = this.repository.getRequest(requestId)
    if (!request) return
    const existingAnalysis = this.repository.listPlateModelAnalyses().find((analysis) => analysis.requestId === requestId)
    const wantsOrientation =
      existingAnalysis?.analysisVersion !== ORIENTATION_ANALYSIS_VERSION || !existingAnalysis.orientationCandidates?.length
    const wants = { thumbnail: !request.thumbnailPath, preview: !request.previewPath, orientation: wantsOrientation }
    if (!wants.thumbnail && !wants.preview && !wants.orientation) {
      this.repository.completeAssetGeneration(requestId, {})
      return
    }

    let file: Uint8Array
    try {
      file = await readAll(await this.assets.read(request.filePath))
    } catch (error) {
      // Storage trouble is transient: leave the request unstamped so the next
      // boot's backfill retries it.
      void this.telemetry.exception(error, { action: 'assets_read', request_id: requestId }).catch(() => undefined)
      log.warn({ err: error }, 'asset source read failed')
      assetJobs.inc({ outcome: 'read_error' })
      assetJobDuration.observe({ outcome: 'read_error' }, (performance.now() - startedAt) / 1000)
      return
    }

    const contentHash = crypto.createHash('sha256').update(file).digest('hex')
    const sharedAnalysis = wantsOrientation
      ? this.repository.findPlateModelAnalysisByContentHash(contentHash, ORIENTATION_ANALYSIS_VERSION)
      : undefined
    if (wantsOrientation) {
      this.repository.startOrientationAnalysis(requestId, ORIENTATION_ANALYSIS_VERSION)
      this.publishUpdate()
    }

    await setImmediate()
    let generated: GeneratedAssets
    try {
      generated = await this.runPipeline(file, { ...wants, orientation: wantsOrientation && !sharedAnalysis })
    } catch (error) {
      // Unparseable model: stamp it processed so it is not retried forever.
      void this.telemetry.exception(error, { action: 'assets_generate', request_id: requestId }).catch(() => undefined)
      log.warn({ err: error }, 'asset generation failed')
      if (wantsOrientation) this.repository.failOrientationAnalysis(requestId, ORIENTATION_ANALYSIS_VERSION, errorMessage(error))
      this.repository.completeAssetGeneration(requestId, {})
      this.publishUpdate()
      assetJobs.inc({ outcome: 'invalid_model' })
      assetJobDuration.observe({ outcome: 'invalid_model' }, (performance.now() - startedAt) / 1000)
      return
    }

    try {
      const thumbnailPath = generated.thumbnailPng ? thumbnailKey(request.filePath, 'image/png') : undefined
      const previewPath = generated.previewStl ? this.assets.previewPath(request.filePath) : undefined
      if (generated.thumbnailPng && thumbnailPath) await this.assets.write(thumbnailPath, generated.thumbnailPng)
      if (generated.previewStl && previewPath) await this.assets.write(previewPath, generated.previewStl)
      const orientationCandidates = sharedAnalysis?.orientationCandidates ?? generated.orientationCandidates
      if (wantsOrientation && orientationCandidates?.length) {
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
      } else if (wantsOrientation) {
        throw new Error('orientation analysis returned no candidates')
      }
      this.repository.completeAssetGeneration(requestId, { thumbnailPath, previewPath })
      this.publishUpdate()
      log.info(
        { durationMs: Math.round(performance.now() - startedAt), thumbnail: !!thumbnailPath, preview: !!previewPath },
        'asset generation completed',
      )
      assetJobs.inc({ outcome: 'success' })
      assetJobDuration.observe({ outcome: 'success' }, (performance.now() - startedAt) / 1000)
    } catch (error) {
      void this.telemetry.exception(error, { action: 'assets_write', request_id: requestId }).catch(() => undefined)
      log.warn({ err: error }, 'generated asset write failed')
      if (wantsOrientation) this.repository.failOrientationAnalysis(requestId, ORIENTATION_ANALYSIS_VERSION, errorMessage(error))
      this.publishUpdate()
      assetJobs.inc({ outcome: 'write_error' })
      assetJobDuration.observe({ outcome: 'write_error' }, (performance.now() - startedAt) / 1000)
    }
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
  if (Number.isFinite(configured) && configured > 0) return Math.min(configured, maximumAssetConcurrency())
  return 8
}

function maximumAssetConcurrency() {
  return 8
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function readAll(asset: { stream: ReadableStream; size: number }): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const reader = (asset.stream as ReadableStream<Uint8Array>).getReader()
  for (let step = await reader.read(); !step.done; step = await reader.read()) chunks.push(step.value)
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}
