import { parseStl } from './stl'

export type MeshAnalysis = {
  widthMm: number
  depthMm: number
  heightMm: number
  estimatedVolumeMm3?: number
  volumeReliable: boolean
}

export const MAX_TOPOLOGY_TRIANGLES = 100_000

export function analyzeMesh(file: Uint8Array): MeshAnalysis {
  return analyzePositions(parseStl(file))
}

export function analyzePositions(positions: Float32Array): MeshAnalysis {
  if (!positions.length || positions.length % 9 !== 0) throw new Error('STL contains no complete triangles')
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  const triangleCount = positions.length / 9
  const validateTopology = triangleCount <= MAX_TOPOLOGY_TRIANGLES
  const edges = validateTopology ? new Map<string, Edge>() : undefined
  const parents = validateTopology ? Uint32Array.from({ length: triangleCount }, (_, index) => index) : undefined
  const signedVolumesSix = validateTopology ? new Float64Array(triangleCount) : undefined

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
    minX = Math.min(minX, ax, bx, cx)
    minY = Math.min(minY, ay, by, cy)
    minZ = Math.min(minZ, az, bz, cz)
    maxX = Math.max(maxX, ax, bx, cx)
    maxY = Math.max(maxY, ay, by, cy)
    maxZ = Math.max(maxZ, az, bz, cz)
    if (edges && parents && signedVolumesSix) {
      const triangle = index / 9
      signedVolumesSix[triangle] = ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)
      addEdge(edges, parents, triangle, ax, ay, az, bx, by, bz)
      addEdge(edges, parents, triangle, bx, by, bz, cx, cy, cz)
      addEdge(edges, parents, triangle, cx, cy, cz, ax, ay, az)
    }
  }

  const componentVolumesSix = new Map<number, number>()
  if (parents && signedVolumesSix) {
    for (let triangle = 0; triangle < triangleCount; triangle++) {
      const component = find(parents, triangle)
      componentVolumesSix.set(component, (componentVolumesSix.get(component) ?? 0) + signedVolumesSix[triangle])
    }
  }
  const estimatedVolumeMm3 = [...componentVolumesSix.values()].reduce((total, volumeSix) => total + Math.abs(volumeSix) / 6, 0)
  const volumeReliable =
    !!edges && [...edges.values()].every((edge) => edge.forward === 1 && edge.reverse === 1) && estimatedVolumeMm3 > Number.EPSILON
  return {
    widthMm: maxX - minX,
    depthMm: maxY - minY,
    heightMm: maxZ - minZ,
    estimatedVolumeMm3: volumeReliable ? estimatedVolumeMm3 : undefined,
    volumeReliable,
  }
}

type Edge = { forward: number; reverse: number; triangle: number }

function addEdge(
  edges: Map<string, Edge>,
  parents: Uint32Array,
  triangle: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
) {
  const first = vertexKey(ax, ay, az)
  const second = vertexKey(bx, by, bz)
  const forward = first < second
  const key = forward ? `${first}|${second}` : `${second}|${first}`
  const edge = edges.get(key)
  if (!edge) {
    edges.set(key, { forward: forward ? 1 : 0, reverse: forward ? 0 : 1, triangle })
    return
  }
  if (forward) edge.forward += 1
  else edge.reverse += 1
  union(parents, triangle, edge.triangle)
}

function vertexKey(x: number, y: number, z: number) {
  return `${x.toPrecision(9)},${y.toPrecision(9)},${z.toPrecision(9)}`
}

function find(parents: Uint32Array, item: number): number {
  let root = item
  while (parents[root] !== root) root = parents[root]
  while (parents[item] !== item) {
    const parent = parents[item]
    parents[item] = root
    item = parent
  }
  return root
}

function union(parents: Uint32Array, first: number, second: number) {
  const firstRoot = find(parents, first)
  const secondRoot = find(parents, second)
  if (firstRoot !== secondRoot) parents[secondRoot] = firstRoot
}
