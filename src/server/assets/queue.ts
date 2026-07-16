import crypto from 'node:crypto'
import { setImmediate } from 'node:timers/promises'
import { Worker } from 'node:worker_threads'
import PQueue from 'p-queue'
import type { AssetStore, EventBus, PrintRequest, PrintType, Repository, Telemetry } from '../../core/types'
import { thumbnailKey } from '../../core/assetKeys'
import { requireModelFormat, type ModelFormat } from '../../core/modelFormat'
import {
  normalizePrinterProfile,
  ORIENTATION_ANALYSIS_VERSION,
  type PlateModelAnalysis,
  type PrinterProfile,
} from '../../core/platePlanner'
import { generateAssets, generateVisualAssets, type AssetWants, type GeneratedAssets } from './pipeline'
import { logger } from '../logger'
import { MODEL_ASSET_WORKER_TIMEOUT_MS, MODEL_WORKER_RESOURCE_LIMITS, resolveWorkerConfig } from './workerConfig'

export class AssetGenerationQueue {
  private visualQueue: PQueue
  private orientationQueue: PQueue
  private visualQueued = new Set<string>()
  private visualRerun = new Set<string>()
  private orientationQueued = new Set<string>()
  private orientationRerun = new Set<string>()
  private workerConfig = resolveWorkerConfig()
  private updateTimer: ReturnType<typeof setTimeout> | undefined
  private updateDone: Promise<void> | undefined
  private resolveUpdate: (() => void) | undefined

  constructor(
    private repository: Repository,
    private assets: AssetStore,
    private events: EventBus,
    private telemetry: Telemetry,
    concurrency = 8,
    workerConfig = resolveWorkerConfig(),
    private workerTimeoutMs = MODEL_ASSET_WORKER_TIMEOUT_MS,
    private thumbnailWriteTimeoutMs = Math.min(workerTimeoutMs, 5_000),
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
  }

  enqueueAnalysis(requestId: string) {
    this.repository.queueOrientationAnalysis(requestId, ORIENTATION_ANALYSIS_VERSION)
    this.enqueueOrientation(requestId, true)
  }

  /** Queue requests without completed asset or orientation stamps. */
  backfill() {
    const requestIds = new Set([
      ...this.repository.requestsNeedingAssets(),
      ...this.repository.requestsNeedingOrientationAnalysis(ORIENTATION_ANALYSIS_VERSION),
    ])
    for (const id of requestIds) this.enqueue(id)
  }

  /** Resolve when all currently queued work finishes. */
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
      worker: !('inline' in this.workerConfig),
      visual: { queued: this.visualQueue.size, running: this.visualQueue.pending, concurrency: this.visualQueue.concurrency },
      orientation: {
        queued: this.orientationQueue.size,
        running: this.orientationQueue.pending,
        concurrency: this.orientationQueue.concurrency,
      },
    }
  }

  private enqueueVisual(requestId: string) {
    if (this.visualQueued.has(requestId)) return
    this.visualQueued.add(requestId)
    void this.visualQueue
      .add(() => this.processVisual(requestId), { priority: 10 })
      .catch((error) => logger.error({ err: error, requestId }, 'visual asset queue job failed'))
      .finally(() => {
        const rerun = this.visualRerun.delete(requestId)
        this.visualQueued.delete(requestId)
        if (rerun) this.enqueueVisual(requestId)
      })
  }

  private enqueueOrientation(requestId: string, rerunIfQueued = false) {
    if (this.orientationQueued.has(requestId)) {
      if (rerunIfQueued) this.orientationRerun.add(requestId)
      return
    }
    this.orientationQueued.add(requestId)
    void this.orientationQueue
      .add(() => this.processOrientationUntilCurrent(requestId))
      .catch((error) => logger.error({ err: error, requestId }, 'orientation queue job failed'))
      .finally(() => {
        const rerun = this.orientationRerun.delete(requestId)
        this.orientationQueued.delete(requestId)
        if (rerun) {
          this.repository.queueOrientationAnalysis(requestId, ORIENTATION_ANALYSIS_VERSION)
          this.enqueueOrientation(requestId)
        }
      })
  }

  private async processOrientationUntilCurrent(requestId: string) {
    while (true) {
      this.orientationRerun.delete(requestId)
      await this.processOrientation(requestId)
      if (!this.orientationRerun.delete(requestId)) return
      this.repository.queueOrientationAnalysis(requestId, ORIENTATION_ANALYSIS_VERSION)
    }
  }

  private async processVisual(requestId: string) {
    const startedAt = performance.now()
    const log = logger.child({ requestId })
    const request = this.repository.getRequest(requestId)
    if (!request) return
    const printType = requestPrintType(this.repository, request)
    const jobs = this.repository.assetGenerationJobs(requestId)
    const wants = {
      thumbnail: jobs.some((job) => job.stage === 'thumbnail' && job.status === 'pending'),
      preview: jobs.some((job) => job.stage === 'preview' && job.status === 'pending'),
    }
    if (!wants.thumbnail && !wants.preview) return
    try {
      const currentRequest = this.repository.getRequest(requestId)
      if (!currentRequest) return
      this.repository.startAssetGeneration(
        requestId,
        [wants.thumbnail ? 'thumbnail' : undefined, wants.preview ? 'preview' : undefined].filter(Boolean) as ('thumbnail' | 'preview')[],
      )
      this.publishUpdate()
      const sourcePath = currentRequest.filePath
      const file = await this.readAsset(sourcePath)
      await setImmediate()
      const generated = await this.runVisualPipeline(file, requireModelFormat(currentRequest.fileName), wants, async (thumbnailPng) => {
        const thumbnailPath = thumbnailKey(sourcePath, 'image/png')
        if (await this.finishGeneratedAsset(requestId, 'thumbnail', thumbnailPath, thumbnailPng)) this.publishUpdate()
      })
      if (wants.preview) {
        if (generated.previewStl) {
          const previewPath = this.assets.previewPath(sourcePath)
          await this.finishGeneratedAsset(requestId, 'preview', previewPath, generated.previewStl)
        } else {
          if (this.repository.getRequest(requestId)) this.repository.finishAssetGeneration(requestId, 'preview', { status: 'skipped' })
        }
      }
      this.publishUpdate()
      log.info({ durationMs: Math.round(performance.now() - startedAt), ...wants }, 'visual asset generation completed')
    } catch (error) {
      const current = this.repository.assetGenerationJobs(requestId)
      const running = (['thumbnail', 'preview'] as const).filter((stage) =>
        current.some((job) => job.stage === stage && job.status === 'running'),
      )
      if (error instanceof AssetReadError) {
        void this.telemetry.exception(error.cause, { action: 'assets_read', print_type: printType }).catch(() => undefined)
        log.warn({ err: error.cause }, 'asset source read failed')
        this.repository.requeueAssetGeneration(requestId, running)
        if (this.repository.getRequest(requestId)?.filePath !== error.path) this.visualRerun.add(requestId)
      } else if (error instanceof AssetWriteError) {
        void this.telemetry.exception(error.cause, { action: 'assets_write', print_type: printType }).catch(() => undefined)
        log.warn({ err: error.cause }, 'generated asset write failed')
        this.repository.requeueAssetGeneration(requestId, running)
      } else {
        void this.telemetry.exception(error, { action: 'assets_generate', print_type: printType }).catch(() => undefined)
        log.warn({ err: error }, 'visual asset generation failed')
        for (const stage of running)
          this.repository.finishAssetGeneration(requestId, stage, { status: 'failed', error: errorMessage(error) })
      }
      this.publishUpdate()
    }
  }

  private async processOrientation(requestId: string) {
    const request = this.repository.getRequest(requestId)
    if (!request) return
    const printType = requestPrintType(this.repository, request)
    const existingAnalysis = this.repository.getPlateModelAnalysis(requestId)
    if (
      existingAnalysis?.analysisVersion === ORIENTATION_ANALYSIS_VERSION &&
      (printType !== 'resin' || existingAnalysis.orientationCandidates?.length)
    )
      return
    try {
      const currentRequest = this.repository.getRequest(requestId)
      if (!currentRequest) return
      this.repository.startOrientationAnalysis(requestId, ORIENTATION_ANALYSIS_VERSION)
      this.publishUpdate()
      const sourceFile = await this.readAsset(currentRequest.filePath)
      const contentHash = crypto.createHash('sha256').update(sourceFile).digest('hex')
      const sharedAnalysis = this.repository.findPlateModelAnalysisByContentHash(contentHash, ORIENTATION_ANALYSIS_VERSION)
      const sharedCandidates = sharedAnalysis?.orientationCandidates
      const sourceGenerated = await this.runPipeline(
        sourceFile,
        {
          thumbnail: false,
          preview: false,
          meshAnalysis: true,
          orientation: printType === 'resin' && !sharedCandidates?.length,
          orientationQuaternions: sharedCandidates?.map((candidate) => candidate.quaternion),
        },
        requireModelFormat(currentRequest.fileName),
      )
      const mesh = sourceGenerated.meshAnalysis
      if (!mesh) throw new Error('mesh analysis returned no result')
      const orientationCandidates =
        printType === 'resin'
          ? (sharedAnalysis?.orientationCandidates ?? sourceGenerated.orientationCandidates)?.map((candidate, index) => ({
              ...candidate,
              ...sourceGenerated.orientationBounds?.[index],
              estimatedVolumeMm3: mesh.estimatedVolumeMm3 ?? 0,
            }))
          : undefined
      if (printType !== 'resin' || orientationCandidates?.length) {
        if (!this.repository.getRequest(requestId)) return
        const selected = orientationCandidates?.[0]
        const analysis: PlateModelAnalysis = {
          requestId,
          contentHash,
          analysisVersion: ORIENTATION_ANALYSIS_VERSION,
          widthMm: mesh.widthMm,
          depthMm: mesh.depthMm,
          heightMm: mesh.heightMm,
          estimatedVolumeMm3: mesh.estimatedVolumeMm3,
          orientationQuaternion: selected?.quaternion,
          orientationIslandCount: selected?.islandCount,
          orientationRisk: selected?.islandRisk,
          orientationCandidates,
        }
        this.repository.upsertPlateModelAnalyses([analysis])
      } else {
        throw new Error('orientation analysis returned no candidates')
      }
      this.publishUpdate()
    } catch (error) {
      if (error instanceof AssetReadError) {
        void this.telemetry.exception(error.cause, { action: 'orientation_read', print_type: printType }).catch(() => undefined)
        this.repository.queueOrientationAnalysis(requestId, ORIENTATION_ANALYSIS_VERSION)
        if (this.repository.getRequest(requestId)?.filePath !== error.path) this.orientationRerun.add(requestId)
      } else {
        this.repository.failOrientationAnalysis(requestId, ORIENTATION_ANALYSIS_VERSION, errorMessage(error))
      }
      this.publishUpdate()
    }
  }

  private async finishGeneratedAsset(requestId: string, stage: 'thumbnail' | 'preview', path: string, contents: Uint8Array) {
    try {
      await this.assets.write(path, contents)
    } catch (error) {
      throw new AssetWriteError(error)
    }
    if (this.repository.finishAssetGeneration(requestId, stage, { status: 'ready', path })) return true
    await this.assets.remove(path)
    return false
  }

  private runVisualPipeline(
    file: Uint8Array,
    format: ModelFormat,
    wants: { thumbnail: boolean; preview: boolean },
    thumbnailReady: (thumbnail: Uint8Array) => void | Promise<void>,
  ): Promise<{ previewStl?: Uint8Array }> {
    if ('inline' in this.workerConfig) return generateVisualAssets(file, format, wants, thumbnailReady)
    const workerConfig = this.workerConfig
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerConfig.path, {
        workerData: { file, format, wants, mode: 'visual' },
        transferList: [file.buffer as ArrayBuffer],
        execArgv: workerConfig.execArgv ?? [],
        resourceLimits: MODEL_WORKER_RESOURCE_LIMITS,
      })
      let settled = false
      let completed = false
      let thumbnailWrite = Promise.resolve()
      const timer = setTimeout(
        () => void settle(() => reject(new Error('visual asset worker exceeded its execution deadline'))),
        this.workerTimeoutMs,
      )
      const settle = async (action: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          await worker.terminate()
        } catch (error) {
          reject(error)
          return
        }
        action()
      }
      const settleAfterThumbnail = (action: () => void) => {
        void withTimeout(thumbnailWrite, this.thumbnailWriteTimeoutMs, 'thumbnail storage exceeded its execution deadline').then(
          () => void settle(action),
          (error) => void settle(() => reject(error)),
        )
      }
      worker.on(
        'message',
        (
          reply:
            | { ok: true; stage: 'thumbnail'; thumbnailPng: Uint8Array }
            | ({ ok: true; stage: 'complete' } & GeneratedAssets)
            | { ok: false; message: string },
        ) => {
          if (!reply.ok) return settleAfterThumbnail(() => reject(new Error(reply.message)))
          if (reply.stage === 'thumbnail') {
            thumbnailWrite = thumbnailWrite.then(() => thumbnailReady(reply.thumbnailPng))
            void thumbnailWrite.catch(() => undefined)
          } else {
            completed = true
            void thumbnailWrite.then(
              () => void settle(() => resolve({ previewStl: reply.previewStl })),
              (error) => void settle(() => reject(error)),
            )
          }
        },
      )
      worker.once('error', (error) => settleAfterThumbnail(() => reject(error)))
      worker.once('exit', (code) => {
        if (code !== 0 || !completed) settleAfterThumbnail(() => reject(new Error(`asset worker exited with code ${code}`)))
      })
    })
  }

  private runPipeline(file: Uint8Array, wants: AssetWants, format: ModelFormat): Promise<GeneratedAssets> {
    if ('inline' in this.workerConfig) return generateAssets(file, format, wants)
    const workerConfig = this.workerConfig
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerConfig.path, {
        workerData: { file, format, wants },
        transferList: [file.buffer as ArrayBuffer],
        execArgv: workerConfig.execArgv ?? [],
        resourceLimits: MODEL_WORKER_RESOURCE_LIMITS,
      })
      let settled = false
      let receivedResult = false
      const timer = setTimeout(
        () => void settle(() => reject(new Error('orientation asset worker exceeded its execution deadline'))),
        this.workerTimeoutMs,
      )
      const settle = async (action: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          await worker.terminate()
        } catch (error) {
          reject(error)
          return
        }
        action()
      }
      worker.once('message', (reply: ({ ok: true } & GeneratedAssets) | { ok: false; message: string }) => {
        receivedResult = true
        void settle(() => (reply.ok ? resolve(reply) : reject(new Error(reply.message))))
      })
      worker.once('error', (error) => void settle(() => reject(error)))
      worker.once('exit', (code) => {
        if (!receivedResult) void settle(() => reject(new Error(`asset worker exited with code ${code}`)))
      })
    })
  }

  private async readAsset(path: string) {
    try {
      return await readAll(await this.assets.read(path))
    } catch (error) {
      throw new AssetReadError(path, error)
    }
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function withTimeout<Result>(promise: Promise<Result>, timeoutMs: number, message: string) {
  return new Promise<Result>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    promise.then(
      (result) => {
        clearTimeout(timer)
        resolve(result)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function requestPrintType(repository: Repository, request: PrintRequest): PrintType | undefined {
  if (!request.printerId) return request.requestedPrintType
  const profiles = repository.getSetting<PrinterProfile[]>('plate-planner-profiles') ?? []
  const printer = profiles.find((profile) => profile.id === request.printerId)
  return printer ? normalizePrinterProfile(printer).printType : undefined
}

class AssetWriteError extends Error {
  constructor(readonly cause: unknown) {
    super(errorMessage(cause))
  }
}

class AssetReadError extends Error {
  constructor(
    readonly path: string,
    readonly cause: unknown,
  ) {
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
