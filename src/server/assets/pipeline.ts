import { MeshoptSimplifier } from 'meshoptimizer'
import { decodePreviewMesh, encodePreviewMesh } from '../../core/mesh/previewMesh'
import { parseStl } from '../../core/mesh/stl'
import { rasterize } from '../../core/mesh/rasterize'
import { encodePng } from './png'

const THUMB_SIZE = 256
const PREVIEW_MIN_BYTES = 12 * 1024 * 1024
const PREVIEW_MIN_TRIANGLES = 400_000
const PREVIEW_MAX_BYTES = 5_000_000
const PREVIEW_MAX_FRACTION = 0.45
const PREVIEW_MAX_ERROR = 0.02
const PREVIEW_INITIAL_TRIANGLES = 1_000_000
const PREVIEW_TARGET_FILL = 0.9

export type GeneratedAssets = {
  previewStl?: Uint8Array
}

export async function generateVisualAssets(
  file: Uint8Array,
  wants: { thumbnail: boolean; preview: boolean },
  thumbnailReady?: (thumbnail: Uint8Array) => void | Promise<void>,
): Promise<{ previewStl?: Uint8Array }> {
  const positions = await parseMesh(file)
  if (wants.thumbnail) {
    const thumbnail = encodePng(rasterize(positions, THUMB_SIZE), THUMB_SIZE, THUMB_SIZE)
    await thumbnailReady?.(thumbnail)
  }
  return { previewStl: wants.preview ? await buildPreview(positions, file.byteLength) : undefined }
}

async function buildPreview(positions: Float32Array, originalBytes: number): Promise<Uint8Array | undefined> {
  const triangleCount = positions.length / 9
  if (originalBytes <= PREVIEW_MIN_BYTES && triangleCount <= PREVIEW_MIN_TRIANGLES) return undefined

  const byteCap = Math.min(PREVIEW_MAX_BYTES, originalBytes * PREVIEW_MAX_FRACTION)
  const indices = new Uint32Array(positions.length / 3)
  for (let index = 0; index < indices.length; index++) indices[index] = index
  await MeshoptSimplifier.ready
  let targetTriangles = Math.min(triangleCount, PREVIEW_INITIAL_TRIANGLES)
  let best: Uint8Array | undefined
  for (let attempt = 0; attempt < 4; attempt++) {
    const previewIndices =
      targetTriangles < triangleCount
        ? MeshoptSimplifier.simplifySloppy(indices, positions, 3, null, targetTriangles * 3, PREVIEW_MAX_ERROR)[0]
        : indices
    if (!previewIndices.length) return best
    const preview = await encodePreviewMesh(positions, previewIndices)
    if (preview.byteLength <= byteCap) {
      best = preview
      if (targetTriangles === triangleCount || preview.byteLength >= byteCap * PREVIEW_TARGET_FILL) return preview
    }
    const adjusted = Math.floor(targetTriangles * (byteCap / preview.byteLength) * PREVIEW_TARGET_FILL)
    if (adjusted === targetTriangles || adjusted <= 0) return best
    targetTriangles = Math.min(triangleCount, adjusted)
  }
  return best
}

async function parseMesh(file: Uint8Array): Promise<Float32Array> {
  const preview = await decodePreviewMesh(file)
  if (preview) return preview
  return parseStl(file)
}
