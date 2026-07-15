import { parentPort, workerData } from 'node:worker_threads'
import { generateAssets, generateVisualAssets } from './pipeline'

// worker_threads entry, bundled separately by `pnpm build` into
// .output/server/assets-worker.mjs. One job per worker: the buffer arrives
// transferred, results transfer back, and the process isolation means a
// pathological mesh cannot stall or crash request handling.
const {
  file,
  wants,
  mode = 'combined',
} = workerData as {
  file: Uint8Array
  wants: { thumbnail: boolean; preview: boolean; orientation?: boolean; meshAnalysis?: boolean }
  mode?: 'combined' | 'visual'
}

const work =
  mode === 'visual'
    ? generateVisualAssets(file, wants, (thumbnailPng) => {
        parentPort!.postMessage({ ok: true as const, stage: 'thumbnail' as const, thumbnailPng }, [thumbnailPng.buffer as ArrayBuffer])
      })
    : generateAssets(file, wants)

work.then(
  (generated) => {
    const thumbnailPng = 'thumbnailPng' in generated ? (generated.thumbnailPng as Uint8Array | undefined) : undefined
    const transfers = [thumbnailPng?.buffer, generated.previewStl?.buffer].filter(
      (buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer,
    )
    parentPort!.postMessage({ ok: true as const, stage: 'complete' as const, ...generated }, transfers)
  },
  (error: unknown) => {
    parentPort!.postMessage({ ok: false as const, message: error instanceof Error ? error.message : String(error) })
  },
)
