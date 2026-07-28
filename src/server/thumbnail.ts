import { setTimeout } from 'node:timers/promises'
import PQueue from 'p-queue'
import type { AssetStore } from '../core/types'

type ThumbnailReadResult = { status: 'ready'; bytes: ArrayBuffer } | { status: 'missing' } | { status: 'unavailable'; error: unknown }

export function createThumbnailReader({ concurrency, retryDelays }: { concurrency: number; retryDelays: number[] }) {
  const queue = new PQueue({ concurrency })
  return async (assets: AssetStore, thumbnailPath: string): Promise<ThumbnailReadResult> =>
    await queue.add(async () => {
      let lastError: unknown
      for (const delay of [0, ...retryDelays]) {
        if (delay) await setTimeout(delay)
        try {
          const asset = await assets.read(thumbnailPath)
          const bytes = await new Response(asset.stream).arrayBuffer()
          return { status: 'ready' as const, bytes }
        } catch (error) {
          if (isMissing(error)) return { status: 'missing' as const }
          lastError = error
        }
      }
      return { status: 'unavailable' as const, error: lastError }
    })
}

export const readThumbnail = createThumbnailReader({ concurrency: 6, retryDelays: [100, 250] })

function isMissing(error: unknown) {
  const failure = error as { code?: string; status?: number }
  return failure?.code === 'ENOENT' || failure?.status === 404
}
