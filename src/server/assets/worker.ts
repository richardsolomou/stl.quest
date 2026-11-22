import { parentPort, workerData } from 'node:worker_threads'
import { errorMessage } from '../../core/error'
import { InvalidMeshError } from '../../core/mesh/stl'
import { generateVisualAssets } from './pipeline'
import { type PlateObject, writePlateObject } from './plateObject'

// worker_threads entry, bundled separately by `pnpm build` into
// .output/server/assets-worker.mjs. One job per worker: the buffer arrives
// transferred, results transfer back, and the process isolation means a
// pathological mesh cannot stall or crash request handling.
const job = workerData as
  | { mode: 'visual'; file: Uint8Array; wants: { thumbnail: boolean; preview: boolean } }
  | { mode: 'plate'; file: Uint8Array; object: PlateObject; xmlPath: string }

const fail = (error: unknown) => {
  parentPort!.postMessage({
    ok: false as const,
    message: errorMessage(error, String(error)),
    invalidMesh: error instanceof InvalidMeshError,
  })
}

if (job.mode === 'plate') {
  try {
    parentPort!.postMessage({ ok: true as const, stage: 'complete' as const, ...writePlateObject(job.file, job.object, job.xmlPath) })
  } catch (error) {
    fail(error)
  }
} else {
  generateVisualAssets(job.file, job.wants, (thumbnailPng) => {
    parentPort!.postMessage({ ok: true as const, stage: 'thumbnail' as const, thumbnailPng }, [thumbnailPng.buffer as ArrayBuffer])
  }).then((generated) => {
    const transfers = [generated.previewStl?.buffer].filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer)
    parentPort!.postMessage({ ok: true as const, stage: 'complete' as const, ...generated }, transfers)
  }, fail)
}
