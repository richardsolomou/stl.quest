import { MeshoptSimplifier } from 'meshoptimizer'
import { exportBinaryStl, parseStl } from '../../core/mesh/stl'
import { rasterize } from '../../core/mesh/rasterize'
import { rankResinOrientations, type ResinOrientation } from '../../core/mesh/resinOrientation'
import { encodePng } from './png'

const THUMB_SIZE = 256
const PREVIEW_MIN_BYTES = 12 * 1024 * 1024
const PREVIEW_MIN_TRIANGLES = 400_000
const PREVIEW_TARGET_TRIANGLES = 100_000
// A preview earns its keep by being meaningfully smaller than the original.
const PREVIEW_MAX_BYTES = 8 * 1024 * 1024
const PREVIEW_MAX_FRACTION = 0.45
const PREVIEW_MAX_ERROR = 0.02

export type GeneratedAssets = {
  thumbnailPng?: Uint8Array
  previewStl?: Uint8Array
  orientationCandidates?: ResinOrientation[]
}

export async function generateVisualAssets(
  file: Uint8Array,
  wants: { thumbnail: boolean; preview: boolean },
  thumbnailReady?: (thumbnail: Uint8Array) => void | Promise<void>,
): Promise<{ previewStl?: Uint8Array }> {
  const positions = parseStl(file)
  if (wants.thumbnail) {
    const thumbnail = encodePng(rasterize(positions, THUMB_SIZE), THUMB_SIZE, THUMB_SIZE)
    await thumbnailReady?.(thumbnail)
  }
  return { previewStl: wants.preview ? await buildPreview(positions, file.byteLength) : undefined }
}

/** Parse the STL once and derive the requested card thumbnail and, for heavy meshes, a decimated preview. */
export async function generateAssets(
  file: Uint8Array,
  wants: { thumbnail: boolean; preview: boolean; orientation?: boolean },
): Promise<GeneratedAssets> {
  const positions = parseStl(file)
  const thumbnailPng = wants.thumbnail ? encodePng(rasterize(positions, THUMB_SIZE), THUMB_SIZE, THUMB_SIZE) : undefined
  const previewStl = wants.preview ? await buildPreview(positions, file.byteLength) : undefined
  const orientationCandidates = wants.orientation ? rankResinOrientations(positions) : undefined
  return { thumbnailPng, previewStl, orientationCandidates }
}

async function buildPreview(positions: Float32Array, originalBytes: number): Promise<Uint8Array | undefined> {
  const triangleCount = positions.length / 9
  if (originalBytes <= PREVIEW_MIN_BYTES && triangleCount <= PREVIEW_MIN_TRIANGLES) return undefined

  const byteCap = Math.min(PREVIEW_MAX_BYTES, originalBytes * PREVIEW_MAX_FRACTION)
  const indices = new Uint32Array(positions.length / 3)
  for (let index = 0; index < indices.length; index++) indices[index] = index
  const targetTriangles = Math.min(PREVIEW_TARGET_TRIANGLES, Math.floor((byteCap - 84) / 50))
  await MeshoptSimplifier.ready
  const [previewIndices] = MeshoptSimplifier.simplifySloppy(indices, positions, 3, null, targetTriangles * 3, PREVIEW_MAX_ERROR)
  if (!previewIndices.length || (previewIndices.length / 3) * 50 + 84 > byteCap) return undefined
  return exportBinaryStl(positions, previewIndices)
}
