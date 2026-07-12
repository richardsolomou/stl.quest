import { MeshoptSimplifier } from 'meshoptimizer'
import { boundingExtent, exportBinaryStl, parseStl } from './stl'
import { rasterize } from './rasterize'
import { encodePng } from './png'

const THUMB_SIZE = 256
const PREVIEW_MIN_BYTES = 12 * 1024 * 1024
const PREVIEW_MIN_TRIANGLES = 400_000
const PREVIEW_TARGET_TRIANGLES = 100_000
// A preview earns its keep by being meaningfully smaller than the original.
const PREVIEW_MAX_BYTES = 8 * 1024 * 1024
const PREVIEW_MAX_FRACTION = 0.45
// Sculpted STLs often need a bigger error budget before they collapse at all.
const ERROR_BUDGETS = [0.02, 0.05, 0.1]

export type GeneratedAssets = { thumbnailPng?: Uint8Array; previewStl?: Uint8Array }

/** Parse the STL once and derive the requested card thumbnail and, for heavy meshes, a decimated preview. */
export async function generateAssets(
  file: Uint8Array,
  wants: { thumbnail: boolean; preview: boolean },
): Promise<GeneratedAssets> {
  const positions = parseStl(file)
  const thumbnailPng = wants.thumbnail ? encodePng(rasterize(positions, THUMB_SIZE), THUMB_SIZE, THUMB_SIZE) : undefined
  const previewStl = wants.preview ? await buildPreview(positions, file.byteLength) : undefined
  return { thumbnailPng, previewStl }
}

async function buildPreview(positions: Float32Array, originalBytes: number): Promise<Uint8Array | undefined> {
  const triangleCount = positions.length / 9
  if (originalBytes <= PREVIEW_MIN_BYTES && triangleCount <= PREVIEW_MIN_TRIANGLES) return undefined

  // Scale-relative welding closes the float-noise cracks sculpt exports are full of.
  const { welded, indices } = weld(positions, boundingExtent(positions) * 1e-4)
  const byteCap = Math.min(PREVIEW_MAX_BYTES, originalBytes * PREVIEW_MAX_FRACTION)
  let accepted: Uint32Array | undefined
  if (indices.length <= PREVIEW_TARGET_TRIANGLES * 3) {
    accepted = indices
  } else {
    await MeshoptSimplifier.ready
    for (const budget of ERROR_BUDGETS) {
      const [candidate] = MeshoptSimplifier.simplify(indices, welded, 3, PREVIEW_TARGET_TRIANGLES * 3, budget, ['Prune'])
      if ((candidate.length / 3) * 50 + 84 <= byteCap) {
        accepted = candidate instanceof Uint32Array ? candidate : new Uint32Array(candidate)
        break
      }
    }
  }
  if (!accepted || (accepted.length / 3) * 50 + 84 > byteCap) return undefined
  return exportBinaryStl(welded, accepted)
}

function weld(positions: Float32Array, tolerance: number): { welded: Float32Array; indices: Uint32Array } {
  const scale = 1 / (tolerance || 1e-8)
  const seen = new Map<string, number>()
  const welded = new Float32Array(positions.length)
  const indices = new Uint32Array(positions.length / 3)
  let unique = 0
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const x = positions[vertex * 3]
    const y = positions[vertex * 3 + 1]
    const z = positions[vertex * 3 + 2]
    const key = `${Math.round(x * scale)}_${Math.round(y * scale)}_${Math.round(z * scale)}`
    let index = seen.get(key)
    if (index === undefined) {
      index = unique++
      seen.set(key, index)
      welded[index * 3] = x
      welded[index * 3 + 1] = y
      welded[index * 3 + 2] = z
    }
    indices[vertex] = index
  }
  return { welded: welded.slice(0, unique * 3), indices }
}
