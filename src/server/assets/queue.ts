import fs from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import type { AssetStore, EventBus, Repository, Telemetry } from '../../core/types'
import { thumbnailKey } from '../../core/assetKeys'
import { generateAssets, type GeneratedAssets } from './pipeline'

// In production the mesh work runs in a per-job worker_thread (bundled by
// `pnpm build` next to the server entry), so a heavy decimation cannot stall
// request handling and an out-of-memory mesh kills the worker, not the app.
// Dev and tests run the pipeline inline.
function resolveWorkerPath(): string | undefined {
  if (!import.meta.env?.PROD) return undefined
  for (const candidate of ['../assets-worker.mjs', './assets-worker.mjs', '../../assets-worker.mjs']) {
    try {
      const resolved = fileURLToPath(new URL(candidate, import.meta.url))
      if (fs.existsSync(resolved)) return resolved
    } catch {}
  }
  console.warn('[printhub] assets-worker.mjs not found next to the server bundle; generating assets in-process')
  return undefined
}

// Serialized background generation of thumbnails and previews: one job at a
// time keeps memory bounded (a job holds the whole STL), and a NAS-scale
// board rarely queues more than a handful.
export class AssetGenerationQueue {
  private chain: Promise<void> = Promise.resolve()
  private workerPath = resolveWorkerPath()

  constructor(
    private repository: Repository,
    private assets: AssetStore,
    private events: EventBus,
    private telemetry: Telemetry,
  ) {}

  enqueue(requestId: string) {
    this.chain = this.chain.then(() => this.process(requestId)).catch(() => undefined)
  }

  /** Queue every request never stamped as processed — new uploads from a crash, imported boards, interrupted jobs. */
  backfill() {
    for (const id of this.repository.requestsNeedingAssets()) this.enqueue(id)
  }

  /** Resolves once everything currently queued has finished; for tests and shutdown. */
  idle() {
    return this.chain
  }

  private async process(requestId: string) {
    const request = this.repository.getRequest(requestId)
    if (!request) return
    const wants = { thumbnail: !request.thumbnailPath, preview: !request.previewPath }
    if (!wants.thumbnail && !wants.preview) {
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
      return
    }

    await setImmediate()
    let generated: GeneratedAssets
    try {
      generated = await this.runPipeline(file, wants)
    } catch (error) {
      // Unparseable model: stamp it processed so it is not retried forever.
      void this.telemetry.exception(error, { action: 'assets_generate', request_id: requestId }).catch(() => undefined)
      this.repository.completeAssetGeneration(requestId, {})
      return
    }

    try {
      const thumbnailPath = generated.thumbnailPng ? thumbnailKey(request.filePath, 'image/png') : undefined
      const previewPath = generated.previewStl ? this.assets.previewPath(request.filePath) : undefined
      if (generated.thumbnailPng && thumbnailPath) await this.assets.write(thumbnailPath, generated.thumbnailPng)
      if (generated.previewStl && previewPath) await this.assets.write(previewPath, generated.previewStl)
      this.repository.completeAssetGeneration(requestId, { thumbnailPath, previewPath })
      this.events.publish('request.updated')
    } catch (error) {
      void this.telemetry.exception(error, { action: 'assets_write', request_id: requestId }).catch(() => undefined)
    }
  }

  private runPipeline(file: Uint8Array, wants: { thumbnail: boolean; preview: boolean }): Promise<GeneratedAssets> {
    if (!this.workerPath) return generateAssets(file, wants)
    return new Promise((resolve, reject) => {
      const worker = new Worker(this.workerPath!, {
        workerData: { file, wants },
        transferList: [file.buffer as ArrayBuffer],
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
