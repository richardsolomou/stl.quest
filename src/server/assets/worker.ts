import { parentPort, workerData } from 'node:worker_threads'
import { errorMessage } from '../../core/error'
import { InvalidMeshError } from '../../core/mesh/stl'
import { generateVisualAssets } from './pipeline'

// worker_threads entry, bundled separately by `pnpm build` into
// .output/server/assets-worker.mjs. One job per worker: the buffer arrives
// transferred, results transfer back, and the process isolation means a
// pathological mesh cannot stall or crash request handling.
const { file, wants } = workerData as {
  file: Uint8Array
  wants: { thumbnail: boolean; preview: boolean }
}

const work = generateVisualAssets(file, wants, (thumbnailPng) => {
  parentPort!.postMessage({ ok: true as const, stage: 'thumbnail' as const, thumbnailPng }, [thumbnailPng.buffer as ArrayBuffer])
})

work.then(
  (generated) => {
    const transfers = [generated.previewStl?.buffer].filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer)
    parentPort!.postMessage({ ok: true as const, stage: 'complete' as const, ...generated }, transfers)
  },
  (error: unknown) => {
    parentPort!.postMessage({
      ok: false as const,
      message: errorMessage(error, String(error)),
      invalidMesh: error instanceof InvalidMeshError,
    })
  },
)
