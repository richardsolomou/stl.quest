import fs from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import PQueue from 'p-queue'
import type { AssetStore, EventBus, Repository, Telemetry } from '../../core/types'
import { storedPrinterProfiles } from '../../core/printers'
import { thumbnailKey } from '../../core/assetKeys'
import { generateVisualAssets, type GeneratedAssets } from './pipeline'
import { logger } from '../logger'

type WorkerConfig = { path: string; execArgv?: string[] }

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

  constructor(
    private repository: Repository,
    private assets: AssetStore,
    private events: EventBus,
    private telemetry: Telemetry,
    concurrency = 8,
    workerConfig = resolveWorkerConfig(),
  ) {
    this.queue = new PQueue({ concurrency })
    this.workerConfig = workerConfig
    this.repository.requeueInterruptedAssetGeneration()
  }

  enqueue(requestId: string) {
    this.repository.queueAssetGeneration(requestId)
    if (this.queued.has(requestId)) return
    this.queued.add(requestId)
    void this.queue
      .add(() => this.process(requestId), { priority: 10 })
      .catch((error) => logger.error({ err: error, requestId }, 'visual asset queue job failed'))
      .finally(() => this.queued.delete(requestId))
  }

  backfill() {
    for (const requestId of new Set([...this.repository.requestsNeedingAssets(), ...this.repository.requestsNeedingModelDimensions()])) {
      this.enqueue(requestId)
    }
  }

  async idle() {
    await this.queue.onIdle()
    await this.updateDone
  }

  async shutdown() {
    this.queue.pause()
    await this.queue.onPendingZero()
    await this.updateDone
  }

  stats() {
    return {
      queued: this.queue.size,
      pending: this.queue.pending,
      concurrency: this.queue.concurrency,
      worker: !!this.workerConfig,
      visual: { queued: this.queue.size, running: this.queue.pending, concurrency: this.queue.concurrency },
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
      file = await readAll(await this.assets.read(request.filePath))
    } catch (error) {
      void this.telemetry.exception(error, { action: 'assets_read', print_type: printType }).catch(() => undefined)
      log.warn({ err: error }, 'asset source read failed')
      this.repository.requeueAssetGeneration(
        requestId,
        (['thumbnail', 'preview'] as const).filter((stage) => wants[stage]),
      )
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
