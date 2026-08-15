import { MeshoptSimplifier } from 'meshoptimizer'
import { decodePreviewMesh, encodePreviewMesh } from '../../core/mesh/previewMesh'
import { parseStl } from '../../core/mesh/stl'
import { isThreeMf, parseThreeMf } from '../../core/mesh/threeMf'
import { rasterize } from '../../core/mesh/rasterize'
import { encodePng } from './png'
import type { ModelDimensions } from '../../core/types'

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
  modelDimensions: ModelDimensions
  modelVolumeMm3?: number
  modelSurfaceAreaMm2?: number
}

export async function generateVisualAssets(
  file: Uint8Array,
  wants: { thumbnail: boolean; preview: boolean },
  thumbnailReady?: (thumbnail: Uint8Array) => void | Promise<void>,
): Promise<GeneratedAssets> {
  const positions = await parseMesh(file)
  if (wants.thumbnail) {
    const thumbnail = encodePng(rasterize(positions, THUMB_SIZE), THUMB_SIZE, THUMB_SIZE)
    await thumbnailReady?.(thumbnail)
  }
  const geometry = meshGeometry(positions)
  return {
    previewStl: wants.preview ? await buildPreview(positions, file.byteLength) : undefined,
    modelDimensions: geometry.dimensions,
    modelVolumeMm3: geometry.volumeMm3,
    modelSurfaceAreaMm2: geometry.surfaceAreaMm2,
  }
}

function meshGeometry(positions: Float32Array): { dimensions: ModelDimensions; volumeMm3?: number; surfaceAreaMm2?: number } {
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  let signedVolumeSix = 0
  let surfaceAreaMm2 = 0
  for (let index = 0; index < positions.length; index += 9) {
    const ax = positions[index]
    const ay = positions[index + 1]
    const az = positions[index + 2]
    const bx = positions[index + 3]
    const by = positions[index + 4]
    const bz = positions[index + 5]
    const cx = positions[index + 6]
    const cy = positions[index + 7]
    const cz = positions[index + 8]
    signedVolumeSix += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)
    const abx = bx - ax
    const aby = by - ay
    const abz = bz - az
    const acx = cx - ax
    const acy = cy - ay
    const acz = cz - az
    const crossX = aby * acz - abz * acy
    const crossY = abz * acx - abx * acz
    const crossZ = abx * acy - aby * acx
    surfaceAreaMm2 += Math.hypot(crossX, crossY, crossZ) / 2
  }
  for (let index = 0; index < positions.length; index++) {
    const axis = index % 3
    bounds[axis] = Math.min(bounds[axis], positions[index])
    bounds[axis + 3] = Math.max(bounds[axis + 3], positions[index])
  }
  const volumeMm3 = Math.abs(signedVolumeSix) / 6
  return {
    dimensions: {
      widthMm: bounds[3] - bounds[0],
      depthMm: bounds[4] - bounds[1],
      heightMm: bounds[5] - bounds[2],
    },
    volumeMm3: volumeMm3 > Number.EPSILON ? volumeMm3 : undefined,
    surfaceAreaMm2: surfaceAreaMm2 > Number.EPSILON ? surfaceAreaMm2 : undefined,
  }
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
  return isThreeMf(file) ? parseThreeMf(file) : parseStl(file)
}
