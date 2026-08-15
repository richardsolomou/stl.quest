import fs from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import PQueue from 'p-queue'
import { errorMessage } from '../../core/error'
import type { AssetStore, EventBus, Repository, Telemetry } from '../../core/types'
import { storedPrinterProfiles } from '../../core/printers'
import { InvalidMeshError } from '../../core/mesh/stl'
import { thumbnailKey } from '../../core/assetKeys'
import { ASSET_GENERATION_MEMORY_BUDGET, ASSET_GENERATION_MEMORY_MULTIPLIER } from '../../core/uploadLimits'
import { generateVisualAssets, type GeneratedAssets } from './pipeline'
import { logger } from '../logger'
import { acquireWorkLease, type WorkLocker, WorkLeaseLost } from '../workLock'

type WorkerConfig = { path: string; execArgv?: string[] }
type AssetQueueOptions = {
  concurrency?: number
  workerConfig?: WorkerConfig
  sourceByteBudget?: number
  workLocker?: WorkLocker
  currentStorage?: () => Promise<boolean>
}

export function resolveAssetQueueLimits(environment: NodeJS.ProcessEnv = process.env) {
  return {
    concurrency: positiveInteger(environment.ASSET_WORKER_CONCURRENCY, 8, 'ASSET_WORKER_CONCURRENCY'),
    sourceByteBudget: positiveInteger(environment.ASSET_WORKER_MEMORY_MB, 4096, 'ASSET_WORKER_MEMORY_MB') * 1024 * 1024,
  }
}

function positiveInteger(value: string | undefined, fallback: number, name: string) {
  if (!value?.trim()) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`)
  return parsed
}

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
  logger.warn({ event: 'asset_worker_unavailable' }, 'assets worker not found next to server bundle; generating assets in-process')
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
  private initialized: Promise<void>
  private workLocker?: WorkLocker
  private currentStorage: () => Promise<boolean>
  private backfillDone?: Promise<void>
  private stopping = false

  constructor(
    private repository: Repository,
    private assets: AssetStore,
    private events: EventBus,
    private telemetry: Telemetry,
    options: AssetQueueOptions = {},
  ) {
    const {
      concurrency = 8,
      workerConfig = resolveWorkerConfig(),
      sourceByteBudget = ASSET_GENERATION_MEMORY_BUDGET,
      workLocker,
      currentStorage = async () => true,
    } = options
    this.queue = new PQueue({ concurrency })
    this.preflight = new PQueue({ concurrency })
    this.workerConfig = workerConfig
    this.sourceBytes = new ByteBudget(sourceByteBudget)
    this.maxSourceBytes = Math.max(1, Math.floor(sourceByteBudget / ASSET_GENERATION_MEMORY_MULTIPLIER))
    this.workLocker = workLocker
    this.currentStorage = currentStorage
    this.initialized = this.repository.requeueInterruptedAssetGeneration()
  }

  async enqueue(requestId: string) {
    await this.initialized
    await this.repository.queueAssetGeneration(requestId)
    this.add(requestId)
  }

  private add(requestId: string) {
    if (this.queued.has(requestId)) return
    this.queued.add(requestId)
    void this.preflight
      .add(() => this.schedule(requestId))
      .catch((error) => {
        this.queued.delete(requestId)
        logger.error({ err: error, event: 'asset_generation_queue_failed', request_id: requestId }, 'visual asset queue job failed')
      })
  }

  async backfill() {
    await this.initialized
    this.backfillDone ??= this.feedBackfill().finally(() => (this.backfillDone = undefined))
  }

  async idle() {
    await this.initialized
    await this.backfillDone
    await this.preflight.onIdle()
    await this.queue.onIdle()
    await this.updateDone
  }

  async shutdown() {
    this.stopping = true
    this.preflight.pause()
    await this.preflight.onPendingZero()
    await this.queue.onIdle()
    this.queue.pause()
    await this.updateDone
  }

  private async feedBackfill() {
    let afterId: string | undefined
    while (!this.stopping) {
      const requestIds = await this.repository.assetGenerationCandidates(afterId, 100)
      if (!requestIds.length) return
      for (const requestId of requestIds) this.add(requestId)
      afterId = requestIds.at(-1)
      await Promise.all([this.preflight.onSizeLessThan(100), this.queue.onSizeLessThan(100)])
    }
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
    if (!this.workLocker) return await this.scheduleClaimed(requestId)
    const lease = await acquireWorkLease(this.workLocker, `assets:${requestId}`, false)
    if (!lease) {
      this.queued.delete(requestId)
      return
    }
    try {
      await this.scheduleClaimed(requestId, lease.signal)
    } finally {
      await lease.release()
      this.queued.delete(requestId)
    }
  }

  private async scheduleClaimed(requestId: string, signal?: AbortSignal) {
    signal?.throwIfAborted()
    if (!(await this.currentStorage())) return
    const request = await this.repository.getRequest(requestId)
    if (!request) return
    const size = await this.assets.stat(request.filePath).catch((error) => {
      logger.warn(
        { err: error, event: 'asset_source_size_lookup_failed', request_id: requestId },
        'asset source size lookup failed; reserving the full generation budget',
      )
      return undefined
    })
    const priority = size ? -size.size : Number.MIN_SAFE_INTEGER
    if (!this.workLocker) {
      void this.queue
        .add(() => this.processWithinBudget(requestId, size), { priority })
        .catch((error) =>
          logger.error({ err: error, event: 'asset_generation_queue_failed', request_id: requestId }, 'visual asset queue job failed'),
        )
        .finally(() => this.queued.delete(requestId))
      return
    }
    await this.queue.add(() => this.processWithinBudget(requestId, size, signal), { priority })
  }

  private async processWithinBudget(requestId: string, size: { size: number } | undefined, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const request = await this.repository.getRequest(requestId)
    if (!request) return
    if (size && size.size > this.maxSourceBytes) {
      await this.failOversizedGeneration(requestId, size.size)
      return
    }
    const estimatedMemory = size ? size.size * ASSET_GENERATION_MEMORY_MULTIPLIER : Number.POSITIVE_INFINITY
    const release = await this.sourceBytes.acquire(estimatedMemory)
    try {
      await this.process(requestId, signal)
    } finally {
      release()
    }
  }

  private async process(requestId: string, signal?: AbortSignal) {
    const startedAt = performance.now()
    const log = logger.child({ request_id: requestId })
    const request = await this.repository.getRequest(requestId)
    if (!request) return
    const printType = request.printerId
      ? (await storedPrinterProfiles(this.repository)).find((printer) => printer.id === request.printerId)?.printType
      : request.requestedPrintType
    const jobs = await this.repository.assetGenerationJobs(requestId)
    const wants = {
      geometry: jobs.some((job) => job.stage === 'geometry' && job.status === 'pending'),
      thumbnail: jobs.some((job) => job.stage === 'thumbnail' && job.status === 'pending'),
      preview: jobs.some((job) => job.stage === 'preview' && job.status === 'pending'),
    }
    const needsGeometry = wants.geometry
    if (!wants.thumbnail && !wants.preview && !needsGeometry) return
    if (!(await this.currentStorage())) return
    const stages = [
      wants.geometry ? 'geometry' : undefined,
      wants.thumbnail ? 'thumbnail' : undefined,
      wants.preview ? 'preview' : undefined,
    ].filter(Boolean) as import('../../core/types').AssetGenerationStage[]
    await this.repository.startAssetGeneration(requestId, stages)
    if (!(await this.currentStorage())) {
      await this.repository.requeueAssetGeneration(requestId, stages)
      return
    }
    log.info({ event: 'asset_generation_started', ...wants, needs_geometry: needsGeometry }, 'visual asset generation started')
    this.publishUpdate()

    let file: Uint8Array
    try {
      file = await readAll(await this.assets.read(request.filePath), this.maxSourceBytes)
    } catch (error) {
      void this.telemetry.exception(error, { action: 'assets_read', print_type: printType }).catch(() => undefined)
      log.warn({ err: error, event: 'asset_source_read_failed' }, 'asset source read failed')
      const failedStages = stages
      if (error instanceof SourceTooLargeError) {
        for (const stage of failedStages)
          await this.repository.finishAssetGeneration(requestId, stage, { status: 'failed', error: error.message })
      } else {
        await this.repository.requeueAssetGeneration(requestId, failedStages)
      }
      this.publishUpdate()
      return
    }

    await setImmediate()
    try {
      signal?.throwIfAborted()
      const generated = await this.runPipeline(file, wants, async (thumbnailPng) => {
        signal?.throwIfAborted()
        const thumbnailPath = thumbnailKey(request.filePath, 'image/png')
        try {
          await this.assets.write(thumbnailPath, thumbnailPng)
        } catch (error) {
          throw new AssetWriteError(error)
        }
        signal?.throwIfAborted()
        await this.repository.finishAssetGeneration(requestId, 'thumbnail', { status: 'ready', path: thumbnailPath })
        this.publishUpdate()
      })
      signal?.throwIfAborted()
      await this.repository.setModelDimensions(
        requestId,
        generated.modelDimensions,
        generated.modelVolumeMm3,
        generated.modelSurfaceAreaMm2,
      )
      if (wants.geometry) {
        await this.repository.finishAssetGeneration(
          requestId,
          'geometry',
          generated.modelVolumeMm3 === undefined
            ? { status: 'skipped', error: 'Model volume could not be calculated from this mesh.' }
            : { status: 'ready' },
        )
      }
      if (wants.preview) {
        if (generated.previewStl) {
          const previewPath = this.assets.previewPath(request.filePath)
          try {
            signal?.throwIfAborted()
            await this.assets.write(previewPath, generated.previewStl)
          } catch (error) {
            throw new AssetWriteError(error)
          }
          signal?.throwIfAborted()
          await this.repository.finishAssetGeneration(requestId, 'preview', { status: 'ready', path: previewPath })
        } else {
          await this.repository.finishAssetGeneration(requestId, 'preview', { status: 'skipped' })
        }
      }
      this.publishUpdate()
      log.info(
        {
          event: 'asset_generation_completed',
          outcome: 'success',
          duration_ms: Math.round(performance.now() - startedAt),
          ...wants,
          needs_geometry: needsGeometry,
        },
        'visual asset generation completed',
      )
    } catch (error) {
      const current = await this.repository.assetGenerationJobs(requestId)
      const running = (['geometry', 'thumbnail', 'preview'] as const).filter((stage) =>
        current.some((job) => job.stage === stage && job.status === 'running'),
      )
      if (error instanceof WorkLeaseLost) {
        await this.repository.requeueAssetGeneration(requestId, running)
      } else if (error instanceof AssetWriteError) {
        void this.telemetry.exception(error.cause, { action: 'assets_write', print_type: printType }).catch(() => undefined)
        log.warn({ err: error.cause, event: 'asset_write_failed' }, 'generated asset write failed')
        await this.repository.requeueAssetGeneration(requestId, running)
      } else if (error instanceof InvalidMeshError) {
        // Malformed or truncated mesh input is a bad upload, not a server fault: record a
        // controlled failure so retries stop, and do not report it to error tracking.
        log.warn({ err: error, event: 'asset_generation_invalid_mesh' }, 'visual asset generation skipped invalid mesh')
        for (const stage of running)
          await this.repository.finishAssetGeneration(requestId, stage, { status: 'failed', error: error.message })
      } else {
        void this.telemetry.exception(error, { action: 'assets_generate', print_type: printType }).catch(() => undefined)
        log.warn({ err: error, event: 'asset_generation_failed' }, 'visual asset generation failed')
        for (const stage of running)
          await this.repository.finishAssetGeneration(requestId, stage, { status: 'failed', error: errorMessage(error, String(error)) })
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
            | { ok: false; message: string; invalidMesh?: boolean },
        ) => {
          if (!reply.ok) return reject(reply.invalidMesh ? new InvalidMeshError(reply.message) : new Error(reply.message))
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

  private async failOversizedGeneration(requestId: string, sourceBytes: number) {
    const stages = (await this.repository.assetGenerationJobs(requestId)).filter((job) => job.status === 'pending').map((job) => job.stage)
    if (!stages.length) return
    const error = new SourceTooLargeError(this.maxSourceBytes, sourceBytes)
    await this.repository.startAssetGeneration(requestId, stages)
    for (const stage of stages) await this.repository.finishAssetGeneration(requestId, stage, { status: 'failed', error: error.message })
    this.publishUpdate()
    logger.warn(
      {
        event: 'asset_generation_source_too_large',
        request_id: requestId,
        source_bytes: sourceBytes,
        max_source_bytes: this.maxSourceBytes,
      },
      'asset source exceeds generation memory budget',
    )
  }
}

class AssetWriteError extends Error {
  constructor(readonly cause: unknown) {
    super(errorMessage(cause, String(cause)))
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
