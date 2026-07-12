export type QuaternionTuple = [number, number, number, number]

export type ResinOrientation = {
  quaternion: QuaternionTuple
  widthMm: number
  depthMm: number
  heightMm: number
  islandCount: number
  islandRisk: number
  supportAreaMm2: number
  estimatedVolumeMm3: number
  supportSpreadMm: number
  centerOfMassOffsetMm: number
  stabilityRisk: number
  loadPathRisk: number
  score: number
}

type Vector = { x: number; y: number; z: number }
type Mesh = { vertices: Vector[]; adjacency: number[][]; triangles: [number, number, number][]; diagonal: number }

const Z_AXIS = { x: 0, y: 0, z: 1 }

export function findBestResinOrientation(positions: Float32Array): ResinOrientation {
  const best = rankResinOrientations(positions, 1)[0]
  if (!best) throw new Error('could not find a resin orientation')
  return best
}

export function rankResinOrientations(positions: Float32Array, limit = 8): ResinOrientation[] {
  const mesh = buildMesh(positions)
  const candidates = orientationCandidates()
  const quick = candidates.map((direction) => quickMetrics(mesh, direction))
  const shortlist = quick
    .sort((first, second) => first.quickScore - second.quickScore)
    .slice(0, Math.min(24, quick.length))
    .concat(quick.filter((entry) => isAxisDirection(entry.direction)))
  const unique = new Map(shortlist.map((entry) => [directionKey(entry.direction), entry]))
  const persistenceThreshold = Math.max(0.35, Math.min(2, mesh.diagonal * 0.004))
  const ranked = [...unique.values()]
    .map((metrics) => orientationResult(mesh, metrics, persistenceThreshold))
    .sort((first, second) => first.score - second.score)
  const diverse: ResinOrientation[] = []
  for (const candidate of ranked) {
    if (diverse.every((selected) => quaternionAngle(selected.quaternion, candidate.quaternion) >= Math.PI / 9)) diverse.push(candidate)
    if (diverse.length >= limit) break
  }
  return diverse
}

export function analyzeResinDirection(positions: Float32Array, direction: [number, number, number]): ResinOrientation {
  const mesh = buildMesh(positions)
  const normalizedDirection = normalize({ x: direction[0], y: direction[1], z: direction[2] })
  const threshold = Math.max(0.35, Math.min(2, mesh.diagonal * 0.004))
  return orientationResult(mesh, quickMetrics(mesh, normalizedDirection), threshold)
}

function orientationResult(mesh: Mesh, metrics: ReturnType<typeof quickMetrics>, persistenceThreshold: number): ResinOrientation {
  const islands = islandMetrics(mesh, metrics.direction, persistenceThreshold)
  const footprintArea = metrics.widthMm * metrics.depthMm
  const score =
    islands.risk * 1_000 +
    islands.count * 2_500 +
    metrics.stabilityRisk * 1_200 +
    metrics.loadPathRisk * 1_800 +
    metrics.supportAreaMm2 * 0.85 +
    metrics.heightMm * 1.5 +
    footprintArea * 0.002
  return {
    quaternion: quaternionFromBasis(metrics.basisX, metrics.basisY, metrics.direction),
    widthMm: metrics.widthMm,
    depthMm: metrics.depthMm,
    heightMm: metrics.heightMm,
    islandCount: islands.count,
    islandRisk: islands.risk,
    supportAreaMm2: metrics.supportAreaMm2,
    estimatedVolumeMm3: metrics.estimatedVolumeMm3,
    supportSpreadMm: metrics.supportSpreadMm,
    centerOfMassOffsetMm: metrics.centerOfMassOffsetMm,
    stabilityRisk: metrics.stabilityRisk,
    loadPathRisk: metrics.loadPathRisk,
    score,
  }
}

function buildMesh(positions: Float32Array): Mesh {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (let index = 0; index < positions.length; index += 3) {
    minX = Math.min(minX, positions[index])
    minY = Math.min(minY, positions[index + 1])
    minZ = Math.min(minZ, positions[index + 2])
    maxX = Math.max(maxX, positions[index])
    maxY = Math.max(maxY, positions[index + 1])
    maxZ = Math.max(maxZ, positions[index + 2])
  }
  const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ)
  const tolerance = Math.max(diagonal * 1e-6, 1e-5)
  const vertices: Vector[] = []
  const vertexMap = new Map<string, number>()
  const triangles: [number, number, number][] = []

  const vertexIndex = (offset: number) => {
    const x = positions[offset]
    const y = positions[offset + 1]
    const z = positions[offset + 2]
    const key = `${Math.round(x / tolerance)},${Math.round(y / tolerance)},${Math.round(z / tolerance)}`
    const existing = vertexMap.get(key)
    if (existing !== undefined) return existing
    const index = vertices.length
    vertices.push({ x, y, z })
    vertexMap.set(key, index)
    return index
  }

  for (let offset = 0; offset < positions.length; offset += 9) {
    const triangle: [number, number, number] = [vertexIndex(offset), vertexIndex(offset + 3), vertexIndex(offset + 6)]
    if (triangle[0] !== triangle[1] && triangle[1] !== triangle[2] && triangle[2] !== triangle[0]) triangles.push(triangle)
  }
  const neighbors = vertices.map(() => new Set<number>())
  for (const [first, second, third] of triangles) {
    neighbors[first].add(second).add(third)
    neighbors[second].add(first).add(third)
    neighbors[third].add(first).add(second)
  }
  return { vertices, adjacency: neighbors.map((entry) => [...entry]), triangles, diagonal }
}

function orientationCandidates(): Vector[] {
  const candidates: Vector[] = [
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: -1, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 },
  ]
  const count = 72
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  for (let index = 0; index < count; index++) {
    const z = 1 - (2 * (index + 0.5)) / count
    const radius = Math.sqrt(1 - z * z)
    const angle = index * goldenAngle
    candidates.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, z })
  }
  return candidates
}

function quickMetrics(mesh: Mesh, direction: Vector) {
  const basisX = perpendicular(direction)
  const basisY = cross(direction, basisX)
  const projected = mesh.vertices.map((vertex) => ({ x: dot(vertex, basisX), y: dot(vertex, basisY), z: dot(vertex, direction) }))
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  let volumeSix = 0
  let volumeCentroidX = 0
  let volumeCentroidY = 0
  let volumeCentroidZ = 0
  let surfaceArea = 0
  let surfaceCentroidX = 0
  let surfaceCentroidY = 0
  let surfaceCentroidZ = 0
  for (const vertex of projected) {
    const { x, y, z } = vertex
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    maxZ = Math.max(maxZ, z)
  }
  let supportAreaMm2 = 0
  let supportCentroidX = 0
  let supportCentroidY = 0
  for (const [first, second, third] of mesh.triangles) {
    const firstVertex = mesh.vertices[first]
    const secondVertex = mesh.vertices[second]
    const thirdVertex = mesh.vertices[third]
    const edgeA = subtract(secondVertex, firstVertex)
    const edgeB = subtract(thirdVertex, firstVertex)
    const areaVector = cross(edgeA, edgeB)
    const doubleArea = length(areaVector)
    if (!doubleArea) continue
    const area = doubleArea / 2
    const centroid = {
      x: (firstVertex.x + secondVertex.x + thirdVertex.x) / 3,
      y: (firstVertex.y + secondVertex.y + thirdVertex.y) / 3,
      z: (firstVertex.z + secondVertex.z + thirdVertex.z) / 3,
    }
    surfaceArea += area
    surfaceCentroidX += centroid.x * area
    surfaceCentroidY += centroid.y * area
    surfaceCentroidZ += centroid.z * area
    const signedVolumeSix = dot(firstVertex, cross(secondVertex, thirdVertex))
    volumeSix += signedVolumeSix
    volumeCentroidX += (firstVertex.x + secondVertex.x + thirdVertex.x) * signedVolumeSix
    volumeCentroidY += (firstVertex.y + secondVertex.y + thirdVertex.y) * signedVolumeSix
    volumeCentroidZ += (firstVertex.z + secondVertex.z + thirdVertex.z) * signedVolumeSix
    const downward = -dot(areaVector, direction) / doubleArea
    if (downward > 0.35) {
      const supportWeight = area * ((downward - 0.35) / 0.65)
      supportAreaMm2 += supportWeight
      supportCentroidX += dot(centroid, basisX) * supportWeight
      supportCentroidY += dot(centroid, basisY) * supportWeight
    }
  }
  const widthMm = maxX - minX
  const depthMm = maxY - minY
  const heightMm = maxZ - minZ
  const signedVolume = volumeSix / 6
  const estimatedVolumeMm3 = Math.abs(signedVolume)
  const volumeCenter =
    estimatedVolumeMm3 > Math.max(1e-6, mesh.diagonal ** 3 * 1e-9)
      ? {
          x: volumeCentroidX / (volumeSix * 4),
          y: volumeCentroidY / (volumeSix * 4),
          z: volumeCentroidZ / (volumeSix * 4),
        }
      : {
          x: surfaceCentroidX / Math.max(surfaceArea, 1),
          y: surfaceCentroidY / Math.max(surfaceArea, 1),
          z: surfaceCentroidZ / Math.max(surfaceArea, 1),
        }
  const supportCenter = {
    x: supportCentroidX / Math.max(supportAreaMm2, 1e-6),
    y: supportCentroidY / Math.max(supportAreaMm2, 1e-6),
  }
  let supportMoment = 0
  for (const [first, second, third] of mesh.triangles) {
    const firstVertex = mesh.vertices[first]
    const secondVertex = mesh.vertices[second]
    const thirdVertex = mesh.vertices[third]
    const areaVector = cross(subtract(secondVertex, firstVertex), subtract(thirdVertex, firstVertex))
    const doubleArea = length(areaVector)
    if (!doubleArea) continue
    const downward = -dot(areaVector, direction) / doubleArea
    if (downward <= 0.35) continue
    const area = doubleArea / 2
    const supportWeight = area * ((downward - 0.35) / 0.65)
    const centroid = {
      x: (firstVertex.x + secondVertex.x + thirdVertex.x) / 3,
      y: (firstVertex.y + secondVertex.y + thirdVertex.y) / 3,
      z: (firstVertex.z + secondVertex.z + thirdVertex.z) / 3,
    }
    const offsetX = dot(centroid, basisX) - supportCenter.x
    const offsetY = dot(centroid, basisY) - supportCenter.y
    supportMoment += (offsetX * offsetX + offsetY * offsetY) * supportWeight
  }
  const supportSpreadMm = Math.sqrt(supportMoment / Math.max(supportAreaMm2, 1e-6))
  const centerOfMassOffsetMm = Math.hypot(dot(volumeCenter, basisX) - supportCenter.x, dot(volumeCenter, basisY) - supportCenter.y)
  const massLengthMm = Math.cbrt(Math.max(estimatedVolumeMm3, surfaceArea * Math.max(mesh.diagonal * 0.01, 0.1)))
  const effectiveSupportRadius = Math.max(Math.sqrt(supportAreaMm2 / Math.PI), supportSpreadMm, mesh.diagonal * 0.01)
  const stabilityRisk = Math.min(
    100,
    (massLengthMm / effectiveSupportRadius) *
      (heightMm / Math.max(effectiveSupportRadius, 1)) *
      (1 + centerOfMassOffsetMm / effectiveSupportRadius),
  )
  const loadPathRisk = progressiveLoadRisk(mesh, projected, minZ, maxZ)
  return {
    direction,
    basisX,
    basisY,
    widthMm,
    depthMm,
    heightMm,
    supportAreaMm2,
    estimatedVolumeMm3,
    supportSpreadMm,
    centerOfMassOffsetMm,
    stabilityRisk,
    loadPathRisk,
    quickScore: supportAreaMm2 + stabilityRisk * 800 + loadPathRisk * 1_200 + heightMm * 1.2 + widthMm * depthMm * 0.001,
  }
}

function progressiveLoadRisk(mesh: Mesh, projected: Vector[], minZ: number, maxZ: number) {
  const height = maxZ - minZ
  if (height <= 0) return 0
  const volumeElements = mesh.triangles
    .map(([first, second, third]) => {
      const signedVolume = dot(mesh.vertices[first], cross(mesh.vertices[second], mesh.vertices[third])) / 6
      const weight = Math.abs(signedVolume)
      return {
        weight,
        x: (projected[first].x + projected[second].x + projected[third].x) / 4,
        y: (projected[first].y + projected[second].y + projected[third].y) / 4,
        z: (projected[first].z + projected[second].z + projected[third].z) / 4,
      }
    })
    .filter((element) => element.weight > 1e-9)
  const totalVolumeWeight = volumeElements.reduce((total, element) => total + element.weight, 0)
  const massElements =
    totalVolumeWeight > Math.max(1e-6, mesh.diagonal ** 3 * 1e-9)
      ? volumeElements
      : mesh.triangles.map(([first, second, third]) => {
          const area =
            length(cross(subtract(mesh.vertices[second], mesh.vertices[first]), subtract(mesh.vertices[third], mesh.vertices[first]))) / 2
          return {
            weight: area * Math.max(mesh.diagonal * 0.01, 0.1),
            x: (projected[first].x + projected[second].x + projected[third].x) / 3,
            y: (projected[first].y + projected[second].y + projected[third].y) / 3,
            z: (projected[first].z + projected[second].z + projected[third].z) / 3,
          }
        })
  let worstRisk = 0
  const sampleCount = 24
  for (let sample = 2; sample < sampleCount - 2; sample++) {
    const plane = minZ + (height * sample) / sampleCount
    const section = crossSection(mesh, projected, plane, Math.max(height * 1e-7, 1e-6))
    if (section.area <= 0 || section.perimeter <= 0) continue
    let weightAbove = 0
    let weightedX = 0
    let weightedY = 0
    let weightedZ = 0
    for (const element of massElements) {
      if (element.z <= plane) continue
      weightAbove += element.weight
      weightedX += element.x * element.weight
      weightedY += element.y * element.weight
      weightedZ += element.z * element.weight
    }
    if (weightAbove <= 0) continue
    const centerX = weightedX / weightAbove
    const centerY = weightedY / weightAbove
    const leverHeight = weightedZ / weightAbove - plane
    const offset = Math.hypot(centerX - section.center.x, centerY - section.center.y)
    const neckRadius = Math.max((2 * section.area) / section.perimeter, mesh.diagonal * 0.005)
    const massLength = Math.cbrt(weightAbove)
    const risk =
      (massLength / neckRadius) *
      (leverHeight / Math.max(neckRadius, 1)) *
      (1 + offset / neckRadius) *
      Math.sqrt(height / Math.max(mesh.diagonal, 1))
    worstRisk = Math.max(worstRisk, risk)
  }
  return Math.min(100, worstRisk)
}

function crossSection(mesh: Mesh, projected: Vector[], plane: number, tolerance: number) {
  const points: { x: number; y: number }[] = []
  for (const triangle of mesh.triangles) {
    for (const [first, second] of [
      [triangle[0], triangle[1]],
      [triangle[1], triangle[2]],
      [triangle[2], triangle[0]],
    ] as const) {
      const start = projected[first]
      const end = projected[second]
      const startDistance = start.z - plane
      const endDistance = end.z - plane
      if (Math.abs(startDistance) <= tolerance) points.push({ x: start.x, y: start.y })
      if (startDistance * endDistance >= 0 || Math.abs(start.z - end.z) <= tolerance) continue
      const ratio = (plane - start.z) / (end.z - start.z)
      points.push({ x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio })
    }
  }
  const hull = convexHull(points, tolerance)
  if (hull.length < 3) return { area: 0, perimeter: 0, center: { x: 0, y: 0 } }
  let twiceArea = 0
  let centerX = 0
  let centerY = 0
  let perimeter = 0
  for (let index = 0; index < hull.length; index++) {
    const current = hull[index]
    const next = hull[(index + 1) % hull.length]
    const crossValue = current.x * next.y - next.x * current.y
    twiceArea += crossValue
    centerX += (current.x + next.x) * crossValue
    centerY += (current.y + next.y) * crossValue
    perimeter += Math.hypot(next.x - current.x, next.y - current.y)
  }
  const area = Math.abs(twiceArea) / 2
  const divisor = 3 * twiceArea
  return {
    area,
    perimeter,
    center: Math.abs(divisor) > tolerance ? { x: centerX / divisor, y: centerY / divisor } : hull[0],
  }
}

function convexHull(points: { x: number; y: number }[], tolerance: number) {
  const unique = new Map(points.map((point) => [`${Math.round(point.x / tolerance)},${Math.round(point.y / tolerance)}`, point]))
  const sorted = [...unique.values()].sort((first, second) => first.x - second.x || first.y - second.y)
  if (sorted.length <= 2) return sorted
  const turn = (first: { x: number; y: number }, second: { x: number; y: number }, third: { x: number; y: number }) =>
    (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x)
  const lower: { x: number; y: number }[] = []
  for (const point of sorted) {
    while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], point) <= tolerance) lower.pop()
    lower.push(point)
  }
  const upper: { x: number; y: number }[] = []
  for (let index = sorted.length - 1; index >= 0; index--) {
    const point = sorted[index]
    while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], point) <= tolerance) upper.pop()
    upper.push(point)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

function islandMetrics(mesh: Mesh, direction: Vector, threshold: number) {
  const heights = mesh.vertices.map((vertex) => dot(vertex, direction))
  const order = heights.map((_, index) => index).sort((first, second) => heights[first] - heights[second])
  const parent = new Int32Array(mesh.vertices.length).fill(-1)
  const birth = new Float64Array(mesh.vertices.length)
  const earliest = order[0]
  let count = 0
  let risk = 0

  const find = (index: number) => {
    let root = index
    while (parent[root] !== root) root = parent[root]
    while (parent[index] !== index) {
      const next = parent[index]
      parent[index] = root
      index = next
    }
    return root
  }

  for (const vertex of order) {
    parent[vertex] = vertex
    birth[vertex] = heights[vertex]
    const adjacentRoots = new Set<number>()
    for (const neighbor of mesh.adjacency[vertex]) if (parent[neighbor] !== -1) adjacentRoots.add(find(neighbor))
    if (!adjacentRoots.size) continue
    let survivor = vertex
    for (const root of adjacentRoots) if (birth[root] < birth[survivor]) survivor = root
    parent[vertex] = survivor
    for (const root of adjacentRoots) {
      if (root === survivor) continue
      const persistence = Math.max(0, heights[vertex] - birth[root])
      if (persistence >= threshold && root !== earliest) {
        count++
        risk += persistence / threshold
      }
      parent[root] = survivor
    }
  }

  const roots = new Set<number>()
  for (let index = 0; index < parent.length; index++) if (parent[index] !== -1) roots.add(find(index))
  for (const root of roots) {
    if (root === find(earliest)) continue
    count++
    risk += Math.max(4, mesh.diagonal / threshold)
  }
  return { count, risk }
}

function quaternionFromBasis(basisX: Vector, basisY: Vector, basisZ: Vector): QuaternionTuple {
  const matrix = new THREE.Matrix4()
    .makeBasis(
      new THREE.Vector3(basisX.x, basisX.y, basisX.z),
      new THREE.Vector3(basisY.x, basisY.y, basisY.z),
      new THREE.Vector3(basisZ.x, basisZ.y, basisZ.z),
    )
    .invert()
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix).normalize()
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w]
}

function quaternionAngle(first: QuaternionTuple, second: QuaternionTuple) {
  const cosine = Math.min(1, Math.abs(first[0] * second[0] + first[1] * second[1] + first[2] * second[2] + first[3] * second[3]))
  return 2 * Math.acos(cosine)
}

function perpendicular(vector: Vector): Vector {
  const reference = Math.abs(vector.z) < 0.9 ? Z_AXIS : { x: 0, y: 1, z: 0 }
  return normalize(cross(reference, vector))
}

function isAxisDirection(direction: Vector) {
  return Math.max(Math.abs(direction.x), Math.abs(direction.y), Math.abs(direction.z)) > 0.999999
}

function directionKey(direction: Vector) {
  return `${direction.x.toFixed(6)},${direction.y.toFixed(6)},${direction.z.toFixed(6)}`
}

function dot(first: Vector, second: Vector) {
  return first.x * second.x + first.y * second.y + first.z * second.z
}

function cross(first: Vector, second: Vector): Vector {
  return {
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x,
  }
}

function subtract(first: Vector, second: Vector): Vector {
  return { x: first.x - second.x, y: first.y - second.y, z: first.z - second.z }
}

function length(vector: Vector) {
  return Math.hypot(vector.x, vector.y, vector.z)
}

function normalize(vector: Vector): Vector {
  const magnitude = length(vector) || 1
  return { x: vector.x / magnitude, y: vector.y / magnitude, z: vector.z / magnitude }
}
import * as THREE from 'three'
