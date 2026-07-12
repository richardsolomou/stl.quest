import { parentPort, workerData } from 'node:worker_threads'
import { generateAssets } from './pipeline'

// worker_threads entry, bundled separately by `pnpm build` into
// .output/server/assets-worker.mjs. One job per worker: the buffer arrives
// transferred, results transfer back, and the process isolation means a
// pathological mesh cannot stall or crash request handling.
const { file, wants } = workerData as { file: Uint8Array; wants: { thumbnail: boolean; preview: boolean; orientation?: boolean } }

generateAssets(file, wants).then(
  (generated) => {
    const transfers = [generated.thumbnailPng?.buffer, generated.previewStl?.buffer].filter(
      (buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer,
    )
    parentPort!.postMessage({ ok: true as const, ...generated }, transfers)
  },
  (error: unknown) => {
    parentPort!.postMessage({ ok: false as const, message: error instanceof Error ? error.message : String(error) })
  },
)
