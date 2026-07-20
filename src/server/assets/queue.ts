import fs from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import PQueue from 'p-queue'
import type { AssetStore, EventBus, Repository, Telemetry } from '../../core/types'
import { storedPrinterProfiles } from '../../core/printers'
import { thumbnailKey } from '../../core/assetKeys'
import { ASSET_GENERATION_MEMORY_BUDGET, ASSET_GENERATION_MEMORY_MULTIPLIER } from '../../core/uploadLimits'
import { generateVisualAssets, type GeneratedAssets } from './pipeline'
import { logger } from '../logger'

type WorkerConfig = { path: string; execArgv?: string[] }

class ByteBudget {
  private used = 0
  private waiters: { bytes: number; resolve: (release: () => void) => void }[] = []
  private limit: number

  constructor(limit: number) {
    this.limit = Math.max(1, limit)
  }

  acquire(bytes: number): Promise<() => void> {
    const reserved = Math.min(Math.max(bytes, 1), this.limit)
    return new Promise((resolve) => {
      this.waiters.push({ bytes: reserved, resolve })
      this.drain()
    })
  }

  private drain() {
    while (this.waiters[0] && this.used + this.waiters[0].bytes <= this.limit) {
      const waiter = this.waiters.shift()!
      this.used += waiter.bytes
      waiter.resolve(() => {
        this.used -= waiter.bytes
        this.drain()
      })
    }
  }
}

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

export class AssetGenerationQueue {
  private queue: PQueue
  private queued = new Set<string>()
  private workerConfig = resolveWorkerConfig()
  private updateTimer: ReturnType<typeof setTimeout> | undefined
  private updateDone: Promise<void> | undefined
  private resolveUpdate: (() => void) | undefined
  private preflight: PQueue
  private sourceBytes: ByteBudget
  private maxSourceBytes: number

  constructor(
    private repository: Repository,
    private assets: AssetStore,
    private events: EventBus,
    private telemetry: Telemetry,
    concurrency = 8,
    workerConfig = resolveWorkerConfig(),
    sourceByteBudget = ASSET_GENERATION_MEMORY_BUDGET,
  ) {
    this.queue = new PQueue({ concurrency })
    this.preflight = new PQueue({ concurrency })
    this.workerConfig = workerConfig
    this.sourceBytes = new ByteBudget(sourceByteBudget)
    this.maxSourceBytes = Math.max(1, Math.floor(sourceByteBudget / ASSET_GENERATION_MEMORY_MULTIPLIER))
    this.repository.requeueInterruptedAssetGeneration()
  }

  enqueue(requestId: string) {
    this.repository.queueAssetGeneration(requestId)
    if (this.queued.has(requestId)) return
    this.queued.add(requestId)
    void this.preflight
      .add(() => this.schedule(requestId))
      .catch((error) => {
        this.queued.delete(requestId)
        logger.error({ err: error, requestId }, 'visual asset queue job failed')
      })
  }

  backfill() {
    for (const requestId of new Set([...this.repository.requestsNeedingAssets(), ...this.repository.requestsNeedingModelDimensions()])) {
      this.enqueue(requestId)
    }
  }

  async idle() {
    await this.preflight.onIdle()
    await this.queue.onIdle()
    await this.updateDone
  }

  async shutdown() {
    this.preflight.pause()
    this.queue.pause()
    await this.preflight.onPendingZero()
    await this.queue.onPendingZero()
    await this.updateDone
  }

  stats() {
    const queued = Math.max(0, this.queued.size - this.queue.pending)
    return {
      queued,
      pending: this.queue.pending,
      concurrency: this.queue.concurrency,
      worker: !!this.workerConfig,
      visual: { queued, running: this.queue.pending, concurrency: this.queue.concurrency },
    }
  }

  private async schedule(requestId: string) {
    const request = this.repository.getRequest(requestId)
    if (!request) {
      this.queued.delete(requestId)
      return
    }
    const size = await this.assets.stat(request.filePath).catch((error) => {
      logger.warn({ err: error, requestId }, 'asset source size lookup failed; reserving the full generation budget')
      return undefined
    })
    const priority = size ? -size.size : Number.MIN_SAFE_INTEGER
    void this.queue
      .add(() => this.processWithinBudget(requestId, size), { priority })
      .catch((error) => logger.error({ err: error, requestId }, 'visual asset queue job failed'))
      .finally(() => this.queued.delete(requestId))
  }

  private async processWithinBudget(requestId: string, size: { size: number } | undefined) {
    const request = this.repository.getRequest(requestId)
    if (!request) return
    if (size && size.size > this.maxSourceBytes) {
      this.failOversizedGeneration(requestId, size.size)
      return
    }
    const estimatedMemory = size ? size.size * ASSET_GENERATION_MEMORY_MULTIPLIER : Number.POSITIVE_INFINITY
    const release = await this.sourceBytes.acquire(estimatedMemory)
    try {
      await this.process(requestId)
    } finally {
      release()
    }
  }

  private async process(requestId: string) {
    const startedAt = performance.now()
    const log = logger.child({ requestId })
    const request = this.repository.getRequest(requestId)
    if (!request) return
    const printType = request.printerId
      ? storedPrinterProfiles(this.repository).find((printer) => printer.id === request.printerId)?.printType
      : request.requestedPrintType
    const jobs = this.repository.assetGenerationJobs(requestId)
    const wants = {
      thumbnail: jobs.some((job) => job.stage === 'thumbnail' && job.status === 'pending'),
      preview: jobs.some((job) => job.stage === 'preview' && job.status === 'pending'),
    }
    const needsDimensions = !request.modelDimensions
    if (!wants.thumbnail && !wants.preview && !needsDimensions) return
    this.repository.startAssetGeneration(
      requestId,
      [wants.thumbnail ? 'thumbnail' : undefined, wants.preview ? 'preview' : undefined].filter(Boolean) as ('thumbnail' | 'preview')[],
    )
    this.publishUpdate()

    let file: Uint8Array
    try {
      file = await readAll(await this.assets.read(request.filePath), this.maxSourceBytes)
    } catch (error) {
      void this.telemetry.exception(error, { action: 'assets_read', print_type: printType }).catch(() => undefined)
      log.warn({ err: error }, 'asset source read failed')
      const stages = (['thumbnail', 'preview'] as const).filter((stage) => wants[stage])
      if (error instanceof SourceTooLargeError) {
        for (const stage of stages) this.repository.finishAssetGeneration(requestId, stage, { status: 'failed', error: error.message })
      } else {
        this.repository.requeueAssetGeneration(requestId, stages)
      }
      this.publishUpdate()
      return
    }

    await setImmediate()
    try {
      const generated = await this.runPipeline(file, wants, async (thumbnailPng) => {
        const thumbnailPath = thumbnailKey(request.filePath, 'image/png')
        try {
          await this.assets.write(thumbnailPath, thumbnailPng)
        } catch (error) {
          throw new AssetWriteError(error)
        }
        this.repository.finishAssetGeneration(requestId, 'thumbnail', { status: 'ready', path: thumbnailPath })
        this.publishUpdate()
      })
      this.repository.setModelDimensions(requestId, generated.modelDimensions)
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
    } catch (error) {
      const current = this.repository.assetGenerationJobs(requestId)
      const running = (['thumbnail', 'preview'] as const).filter((stage) =>
        current.some((job) => job.stage === stage && job.status === 'running'),
      )
      if (error instanceof AssetWriteError) {
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

  private runPipeline(
    file: Uint8Array,
    wants: { thumbnail: boolean; preview: boolean },
    thumbnailReady: (thumbnail: Uint8Array) => void | Promise<void>,
  ): Promise<GeneratedAssets> {
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
          else void thumbnailWrite.then(() => resolve(reply), reject)
        },
      )
      worker.once('error', reject)
      worker.once('exit', (code) => {
        if (code !== 0) reject(new Error(`asset worker exited with code ${code}`))
      })
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

  private failOversizedGeneration(requestId: string, sourceBytes: number) {
    const stages = this.repository
      .assetGenerationJobs(requestId)
      .filter((job) => job.status === 'pending')
      .map((job) => job.stage)
    if (!stages.length) return
    const error = new SourceTooLargeError(this.maxSourceBytes, sourceBytes)
    this.repository.startAssetGeneration(requestId, stages)
    for (const stage of stages) this.repository.finishAssetGeneration(requestId, stage, { status: 'failed', error: error.message })
    this.publishUpdate()
    logger.warn({ requestId, sourceBytes, maxSourceBytes: this.maxSourceBytes }, 'asset source exceeds generation memory budget')
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

class AssetWriteError extends Error {
  constructor(readonly cause: unknown) {
    super(errorMessage(cause))
  }
}

class SourceTooLargeError extends Error {
  constructor(maxSourceBytes: number, sourceBytes: number) {
    super(`asset source is ${sourceBytes} bytes; generation limit is ${maxSourceBytes} bytes`)
  }
}

async function readAll(asset: { stream: ReadableStream; size: number }, maxBytes: number): Promise<Uint8Array> {
  let output = new Uint8Array(Math.min(asset.size, maxBytes))
  let offset = 0
  const reader = (asset.stream as ReadableStream<Uint8Array>).getReader()
  for (let step = await reader.read(); !step.done; step = await reader.read()) {
    const nextOffset = offset + step.value.length
    if (nextOffset > maxBytes) {
      await reader.cancel()
      throw new SourceTooLargeError(maxBytes, nextOffset)
    }
    if (nextOffset > output.length) {
      const expanded = new Uint8Array(Math.min(maxBytes, Math.max(nextOffset, output.length * 2, 1)))
      expanded.set(output)
      output = expanded
    }
    output.set(step.value, offset)
    offset += step.value.length
  }
  return offset === output.length ? output : output.slice(0, offset)
}
