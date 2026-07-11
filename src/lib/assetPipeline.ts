import * as THREE from 'three'
import { STLExporter, mergeVertices } from 'three-stdlib'
import { MeshoptSimplifier } from 'meshoptimizer'
import { buildScene, frameCamera, parseStl } from './stl'

const THUMB_SIZE = 256
const PREVIEW_MIN_BYTES = 12 * 1024 * 1024
const PREVIEW_MIN_TRIANGLES = 400_000
const PREVIEW_TARGET_TRIANGLES = 100_000

export type GeneratedAssets = { thumbnailBlob?: Blob; previewBytes?: ArrayBuffer }

function canvasToBlob(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob | null> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/png' })
  return new Promise((resolve) => (canvas as HTMLCanvasElement).toBlob(resolve, 'image/png'))
}

async function renderThumbnail(
  geometry: THREE.BufferGeometry,
  canvas: HTMLCanvasElement | OffscreenCanvas,
): Promise<Blob | undefined> {
  let renderer: THREE.WebGLRenderer | undefined
  try {
    const { scene, mesh } = buildScene(geometry)
    const camera = new THREE.PerspectiveCamera(40, 1)
    frameCamera(camera, mesh)
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setSize(THUMB_SIZE, THUMB_SIZE, false)
    renderer.render(scene, camera)
    return (await canvasToBlob(canvas)) ?? undefined
  } catch {
    return undefined
  } finally {
    renderer?.dispose()
  }
}

// A preview earns its keep by being meaningfully smaller than the original.
const PREVIEW_MAX_BYTES = 8 * 1024 * 1024
const PREVIEW_MAX_FRACTION = 0.45
// Sculpted STLs often need a bigger error budget before they collapse at all.
const ERROR_BUDGETS = [0.02, 0.05, 0.1]

async function buildPreview(
  geometry: THREE.BufferGeometry,
  originalBytes: number,
): Promise<ArrayBuffer | undefined> {
  try {
    const triangleCount = geometry.attributes.position.count / 3
    if (originalBytes <= PREVIEW_MIN_BYTES && triangleCount <= PREVIEW_MIN_TRIANGLES) return undefined

    geometry.computeBoundingBox()
    const extent = new THREE.Vector3()
    geometry.boundingBox!.getSize(extent)
    // Scale-relative welding closes the float-noise cracks sculpt exports are full of.
    const indexed = mergeVertices(geometry, extent.length() * 1e-4)
    const positions = new Float32Array(indexed.attributes.position.array)
    const indices = new Uint32Array(indexed.index!.array)
    indexed.dispose()
    const byteCap = Math.min(PREVIEW_MAX_BYTES, originalBytes * PREVIEW_MAX_FRACTION)
    let accepted: Uint32Array | undefined
    if (indices.length <= PREVIEW_TARGET_TRIANGLES * 3) {
      accepted = indices
    } else {
      await MeshoptSimplifier.ready
      for (const budget of ERROR_BUDGETS) {
        const [candidate] = MeshoptSimplifier.simplify(
          indices,
          positions,
          3,
          PREVIEW_TARGET_TRIANGLES * 3,
          budget,
          ['Prune'],
        )
        if (candidate.length / 3 * 50 + 84 <= byteCap) {
          accepted = candidate
          break
        }
      }
    }
    if (!accepted || accepted.length / 3 * 50 + 84 > byteCap) return undefined

    const simplified = new THREE.BufferGeometry()
    simplified.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    simplified.setIndex(new THREE.BufferAttribute(accepted, 1))
    simplified.computeVertexNormals()
    const binary = new STLExporter().parse(new THREE.Mesh(simplified), { binary: true }) as unknown as DataView
    simplified.dispose()
    return binary.buffer as ArrayBuffer
  } catch {
    return undefined
  }
}

/** Parse the STL once and derive the card thumbnail and, for heavy meshes, a decimated preview. */
export async function generateAssets(
  buffer: ArrayBuffer,
  canvas?: HTMLCanvasElement | OffscreenCanvas,
): Promise<GeneratedAssets> {
  try {
    const geometry = parseStl(buffer)
    const thumbnailBlob = canvas ? await renderThumbnail(geometry, canvas) : undefined
    const previewBytes = await buildPreview(geometry, buffer.byteLength)
    geometry.dispose()
    return { thumbnailBlob, previewBytes }
  } catch {
    return {}
  }
}
