import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { analyzeResinDirection, findBestResinOrientation, rankResinOrientations } from './resinOrientation'

describe('resin orientation', () => {
  it('rotates overhang-born islands so the connected bridge prints first', () => {
    const positions = archSheet()
    const feetFirst = analyzeResinDirection(positions, [0, 0, 1])
    const bridgeFirst = analyzeResinDirection(positions, [0, 0, -1])
    const best = findBestResinOrientation(positions)

    expect(feetFirst.islandCount).toBeGreaterThan(bridgeFirst.islandCount)
    expect(bridgeFirst.islandCount).toBe(0)
    expect(bridgeFirst.score).toBeLessThan(feetFirst.score)
    expect(best.islandCount).toBe(0)
  })

  it('returns distinct ranked candidates for semantic reranking', () => {
    const candidates = rankResinOrientations(archSheet(), 6)
    expect(candidates.length).toBeGreaterThan(1)
    expect(candidates).toEqual([...candidates].sort((first, second) => first.score - second.score))
  })

  it('stores a full transform whose rendered bounds match the packed dimensions', () => {
    const positions = rectangularBox(4, 9, 17, 12, -7, 3)
    for (const candidate of rankResinOrientations(positions, 8)) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
      geometry.applyQuaternion(new THREE.Quaternion(...candidate.quaternion))
      const size = new THREE.Box3()
        .setFromBufferAttribute(geometry.getAttribute('position') as THREE.BufferAttribute)
        .getSize(new THREE.Vector3())
      expect(size.x).toBeCloseTo(candidate.widthMm, 4)
      expect(size.y).toBeCloseTo(candidate.depthMm, 4)
      expect(size.z).toBeCloseTo(candidate.heightMm, 4)
      geometry.dispose()
    }
  })

  it('minimizes the in-plane footprint without changing the build direction', () => {
    const angle = Math.PI / 6
    const positions = rectangularBox(40, 10, 8, 0, 0, 0)
    for (let index = 0; index < positions.length; index += 3) {
      const x = positions[index]
      const y = positions[index + 1]
      positions[index] = x * Math.cos(angle) - y * Math.sin(angle)
      positions[index + 1] = x * Math.sin(angle) + y * Math.cos(angle)
    }

    const orientation = analyzeResinDirection(positions, [0, 0, 1])

    expect([orientation.widthMm, orientation.depthMm].sort((first, second) => first - second)).toEqual([
      expect.closeTo(10, 4),
      expect.closeTo(40, 4),
    ])
    expect(orientation.heightMm).toBeCloseTo(8, 4)
  })

  it('penalizes tall narrow orientations that need stiff supports to resist wobble', () => {
    const positions = rectangularBox(8, 8, 60, 0, 0, 0)
    const upright = analyzeResinDirection(positions, [0, 0, 1])
    const lyingDown = analyzeResinDirection(positions, [1, 0, 0])

    expect(upright.islandCount).toBe(lyingDown.islandCount)
    expect(upright.estimatedVolumeMm3).toBeCloseTo(lyingDown.estimatedVolumeMm3, 4)
    expect(upright.stabilityRisk).toBeGreaterThan(lyingDown.stabilityRisk * 5)
    expect(upright.score).toBeGreaterThan(lyingDown.score)
  })

  it('penalizes a thin neck carrying a heavy mass above it', () => {
    const positions = combineMeshes(rectangularBox(6, 6, 30, 0, 0, 15), rectangularBox(30, 30, 20, 0, 0, 40))
    const neckFirst = analyzeResinDirection(positions, [0, 0, 1])
    const massFirst = analyzeResinDirection(positions, [0, 0, -1])

    expect(neckFirst.estimatedVolumeMm3).toBeCloseTo(massFirst.estimatedVolumeMm3, 4)
    expect(neckFirst.loadPathRisk).toBeGreaterThan(massFirst.loadPathRisk * 2)
    expect(neckFirst.score).toBeGreaterThan(massFirst.score)
  })

  it('keeps a clearly pre-supported mesh in its uploaded orientation', () => {
    const positions = combineMeshes(tessellatedPlane(40, 40, 0), layeredBox(2, 2, 30, 0, 0, 1, 10))
    const candidates = rankResinOrientations(positions, 4)

    expect(candidates[0]).toEqual(expect.objectContaining({ quaternion: [0, 0, 0, 1], isPreSupported: true }))
  })

  it('does not treat a model with a broad solid base as pre-supported', () => {
    const positions = layeredBox(40, 40, 30, 0, 0, 0, 10)
    const candidates = rankResinOrientations(positions, 4)

    expect(candidates.some((candidate) => candidate.isPreSupported)).toBe(false)
  })
})

function archSheet() {
  const triangles: number[] = []
  for (let x = 0; x < 5; x++) {
    for (let z = 0; z < 5; z++) {
      if (z < 4 && x > 0 && x < 4) continue
      triangles.push(x, 0, z, x + 1, 0, z, x + 1, 0, z + 1)
      triangles.push(x, 0, z, x + 1, 0, z + 1, x, 0, z + 1)
    }
  }
  return new Float32Array(triangles)
}

function rectangularBox(width: number, depth: number, height: number, centerX: number, centerY: number, centerZ: number) {
  const x0 = centerX - width / 2
  const x1 = centerX + width / 2
  const y0 = centerY - depth / 2
  const y1 = centerY + depth / 2
  const z0 = centerZ - height / 2
  const z1 = centerZ + height / 2
  const corners = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ]
  const faces = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ]
  return new Float32Array(faces.flatMap((face) => face.flatMap((index) => corners[index])))
}

function combineMeshes(...meshes: Float32Array[]) {
  return new Float32Array(meshes.flatMap((mesh) => [...mesh]))
}

function tessellatedPlane(width: number, depth: number, z: number) {
  const triangles: number[] = []
  const steps = 10
  for (let x = 0; x < steps; x++) {
    for (let y = 0; y < steps; y++) {
      const x0 = -width / 2 + (x / steps) * width
      const x1 = -width / 2 + ((x + 1) / steps) * width
      const y0 = -depth / 2 + (y / steps) * depth
      const y1 = -depth / 2 + ((y + 1) / steps) * depth
      triangles.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z)
    }
  }
  return new Float32Array(triangles)
}

function layeredBox(width: number, depth: number, height: number, centerX: number, centerY: number, bottomZ: number, layers: number) {
  return combineMeshes(
    ...Array.from({ length: layers }, (_, index) =>
      rectangularBox(width, depth, height / layers, centerX, centerY, bottomZ + ((index + 0.5) * height) / layers),
    ),
  )
}
