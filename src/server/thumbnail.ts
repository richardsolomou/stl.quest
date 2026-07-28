import { setTimeout } from 'node:timers/promises'
import type { AssetStore } from '../core/types'

type ThumbnailReadResult = { status: 'ready'; bytes: ArrayBuffer } | { status: 'missing' } | { status: 'unavailable'; error: unknown }

export function createThumbnailReader({ retryDelays }: { retryDelays: number[] }) {
  return async (assets: AssetStore, thumbnailPath: string): Promise<ThumbnailReadResult> => {
    let lastError: unknown
    for (const delay of [0, ...retryDelays]) {
      if (delay) await setTimeout(delay)
      try {
        const asset = await assets.read(thumbnailPath)
        const bytes = await new Response(asset.stream).arrayBuffer()
        return { status: 'ready', bytes }
      } catch (error) {
        if (isMissing(error)) return { status: 'missing' }
        lastError = error
      }
    }
    return { status: 'unavailable', error: lastError }
  }
}

export const readThumbnail = createThumbnailReader({ retryDelays: [100, 250] })

function isMissing(error: unknown) {
  const failure = error as { code?: string; status?: number }
  return failure?.code === 'ENOENT' || failure?.status === 404
}
