import { setImmediate } from 'node:timers/promises'
import type { AssetStore, EventBus, Repository, Telemetry } from '../../core/types'
import { thumbnailKey } from '../../core/assetKeys'
import { generateAssets } from './pipeline'

// Serialized background generation of thumbnails and previews. One job at a
// time keeps memory bounded (a job holds the whole STL); jobs run on the main
// thread but yield between stages, and a NAS-scale board rarely queues more
// than a handful.
export class AssetGenerationQueue {
  private chain: Promise<void> = Promise.resolve()

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
    let generated: Awaited<ReturnType<typeof generateAssets>>
    try {
      generated = await generateAssets(file, wants)
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
