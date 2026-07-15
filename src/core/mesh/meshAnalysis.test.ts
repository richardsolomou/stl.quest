import { describe, expect, it } from 'vitest'
import { analyzePositions, MAX_TOPOLOGY_TRIANGLES } from './meshAnalysis'

const tetrahedron = new Float32Array([
  0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1,
])

function reverseWinding(positions: Float32Array) {
  const reversed = new Float32Array(positions)
  for (let index = 0; index < reversed.length; index += 9) {
    const bx = reversed[index + 3]
    const by = reversed[index + 4]
    const bz = reversed[index + 5]
    reversed[index + 3] = reversed[index + 6]
    reversed[index + 4] = reversed[index + 7]
    reversed[index + 5] = reversed[index + 8]
    reversed[index + 6] = bx
    reversed[index + 7] = by
    reversed[index + 8] = bz
  }
  return reversed
}

function translate(positions: Float32Array, x: number, y: number, z: number) {
  return positions.map((value, index) => value + (index % 3 === 0 ? x : index % 3 === 1 ? y : z))
}

describe('mesh analysis', () => {
  it('measures original bounds and enclosed volume', () => {
    expect(analyzePositions(tetrahedron)).toEqual({
      widthMm: 1,
      depthMm: 1,
      heightMm: 1,
      estimatedVolumeMm3: 1 / 6,
      volumeReliable: true,
    })
  })

  it('does not claim material volume for an open mesh', () => {
    expect(analyzePositions(tetrahedron.slice(0, -9))).toMatchObject({ estimatedVolumeMm3: undefined, volumeReliable: false })
  })

  it('treats inconsistent face winding as unreliable', () => {
    const inconsistent = new Float32Array(tetrahedron)
    inconsistent.set(reverseWinding(inconsistent.slice(0, 9)), 0)

    expect(analyzePositions(inconsistent)).toMatchObject({ estimatedVolumeMm3: undefined, volumeReliable: false })
  })

  it('sums absolute volumes for disconnected closed shells with opposite global winding', () => {
    const oppositeShell = translate(reverseWinding(tetrahedron), 3, 0, 0)
    const shells = new Float32Array(tetrahedron.length + oppositeShell.length)
    shells.set(tetrahedron)
    shells.set(oppositeShell, tetrahedron.length)

    expect(analyzePositions(shells)).toMatchObject({ estimatedVolumeMm3: 1 / 3, volumeReliable: true })
  })

  it('returns bounds without material volume when topology validation exceeds the triangle budget', () => {
    const triangle = new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 4])
    const positions = new Float32Array((MAX_TOPOLOGY_TRIANGLES + 1) * triangle.length)
    for (let index = 0; index < positions.length; index += triangle.length) positions.set(triangle, index)

    expect(analyzePositions(positions)).toEqual({
      widthMm: 2,
      depthMm: 3,
      heightMm: 4,
      estimatedVolumeMm3: undefined,
      volumeReliable: false,
    })
  })

  it('is independent of translation', () => {
    const translated = translate(tetrahedron, 10, -4, 7)
    expect(analyzePositions(translated).estimatedVolumeMm3).toBeCloseTo(1 / 6)
  })
})
