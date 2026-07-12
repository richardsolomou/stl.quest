import { describe, expect, it } from 'vitest'
import { generateAssets } from './pipeline'
import { exportBinaryStl, parseStl } from '../../core/mesh/stl'

function sphereStl(rings: number, segments: number, radius = 20): Uint8Array {
  const verts: number[] = []
  const point = (ring: number, segment: number) => {
    const phi = (ring / rings) * Math.PI
    const theta = (segment / segments) * 2 * Math.PI
    return [radius * Math.sin(phi) * Math.cos(theta), radius * Math.sin(phi) * Math.sin(theta), radius * Math.cos(phi)]
  }
  for (let ring = 0; ring < rings; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      const a = point(ring, segment)
      const b = point(ring + 1, segment)
      const c = point(ring + 1, segment + 1)
      const d = point(ring, segment + 1)
      verts.push(...a, ...b, ...c, ...a, ...c, ...d)
    }
  }
  const positions = new Float32Array(verts)
  const indices = new Uint32Array(positions.length / 3)
  for (let index = 0; index < indices.length; index++) indices[index] = index
  return exportBinaryStl(positions, indices)
}

describe('server asset pipeline', () => {
  it('parses binary STL and renders a non-empty transparent-background thumbnail', async () => {
    const { thumbnailPng } = await generateAssets(sphereStl(24, 32), { thumbnail: true, preview: false })
    expect(thumbnailPng!.subarray(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    expect(thumbnailPng!.length).toBeGreaterThan(1000)
  })

  it('parses ascii STL', () => {
    const ascii = new TextEncoder().encode(`solid probe
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 10 0 0
    vertex 0 10 0
  endloop
endfacet
endsolid probe`)
    const positions = parseStl(ascii)
    expect(positions.length).toBe(9)
  })

  it('rejects garbage input', () => {
    expect(() => parseStl(new TextEncoder().encode('not an stl at all'))).toThrow('Offset is outside the bounds')
  })

  it('generates ranked resin orientations from the original STL', async () => {
    const generated = await generateAssets(sphereStl(12, 16), { thumbnail: false, preview: false, orientation: true })
    expect(generated.orientationCandidates?.length).toBeGreaterThan(1)
    expect(generated.orientationCandidates).toEqual(
      [...generated.orientationCandidates!].sort((first, second) => first.score - second.score),
    )
  })

  it('skips previews for small meshes and decimates heavy ones under the byte cap', async () => {
    const small = await generateAssets(sphereStl(24, 32), { thumbnail: false, preview: true })
    expect(small.previewStl).toBeUndefined()

    const heavy = sphereStl(420, 500) // 420k triangles ≈ 21 MB, over both thresholds
    const { previewStl } = await generateAssets(heavy, { thumbnail: false, preview: true })
    expect(previewStl).toBeDefined()
    expect(previewStl!.length).toBeLessThan(Math.min(8 * 1024 * 1024, heavy.length * 0.45))
    // The preview is itself a valid STL.
    expect(parseStl(previewStl!).length).toBeGreaterThan(0)
  }, 60_000)
})
