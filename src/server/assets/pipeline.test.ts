import { describe, expect, it } from 'vitest'
import { generateVisualAssets } from './pipeline'
import { decodePreviewMesh } from '../../core/mesh/previewMesh'
import { exportBinaryStl, InvalidMeshError, parseStl } from '../../core/mesh/stl'
import { zipSync, strToU8 } from 'fflate'

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
  it('parses a 3MF build with object transforms and renders its thumbnail', async () => {
    const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="centimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources><object id="1" type="model"><mesh>
    <vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="2" z="0"/></vertices>
    <triangles><triangle v1="0" v2="1" v3="2"/></triangles>
  </mesh></object><object id="2" type="model"><components>
    <component objectid="1" transform="1 0 0 0 1 0 0 0 1 2 0 0"/>
  </components></object></resources>
  <build><item objectid="1"/><item objectid="2"/></build>
</model>`
    const file = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), '3D/3dmodel.model': strToU8(model) })
    let thumbnail: Uint8Array | undefined
    const generated = await generateVisualAssets(file, { thumbnail: true, preview: false }, (value) => {
      thumbnail = value
    })
    expect(generated.modelDimensions).toEqual({ widthMm: 30, depthMm: 20, heightMm: 0 })
    expect(thumbnail?.subarray(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
  })

  it('resolves production-extension components stored in separate model parts', async () => {
    const main = `<?xml version="1.0"?><model unit="centimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
<resources><object id="2" type="model"><components><component p:path="/3D/Objects/part.model" objectid="1"/></components></object></resources>
<build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 2 0 0"/></build></model>`
    const part = `<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="20" z="0"/></vertices>
<triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources></model>`
    const file = zipSync({ '3D/3dmodel.model': strToU8(main), '3D/Objects/part.model': strToU8(part) })
    const generated = await generateVisualAssets(file, { thumbnail: false, preview: false })
    expect(generated.modelDimensions).toEqual({ widthMm: 10, depthMm: 20, heightMm: 0 })
  })

  it('parses binary STL and renders a non-empty transparent-background thumbnail', async () => {
    let thumbnailPng: Uint8Array | undefined
    const generated = await generateVisualAssets(sphereStl(24, 32), { thumbnail: true, preview: false }, (thumbnail) => {
      thumbnailPng = thumbnail
    })
    expect(thumbnailPng!.subarray(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    expect(thumbnailPng!.length).toBeGreaterThan(1000)
    expect(generated.modelVolumeMm3).toBeGreaterThan(32_000)
    expect(generated.modelVolumeMm3).toBeLessThan(34_000)
  })

  it('ignores binary STL facet colors when rendering thumbnails', async () => {
    const plain = sphereStl(8, 12)
    const colored = plain.slice()
    for (let offset = 84 + 48; offset < colored.length; offset += 50) {
      colored[offset] = 0xff
      colored[offset + 1] = 0xff
    }

    const render = async (file: Uint8Array) => {
      let thumbnail: Uint8Array | undefined
      await generateVisualAssets(file, { thumbnail: true, preview: false }, (generated) => {
        thumbnail = generated
      })
      return thumbnail
    }

    expect(await render(colored)).toEqual(await render(plain))
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

  it('rejects garbage input with a controlled error', () => {
    expect(() => parseStl(new TextEncoder().encode('not an stl at all'))).toThrow(InvalidMeshError)
  })

  it('rejects truncated binary STL with a controlled error', () => {
    const whole = sphereStl(8, 12)
    // Keep the 84-byte header (declaring the full triangle count) but drop the trailing
    // face data, so the header promises more bytes than the buffer holds.
    const truncated = whole.slice(0, whole.length - 200)
    expect(() => parseStl(truncated)).toThrow(InvalidMeshError)
    expect(() => parseStl(truncated)).not.toThrow('Offset is outside the bounds')
  })

  it('skips previews for small meshes and decimates heavy ones under the byte cap', async () => {
    const small = await generateVisualAssets(sphereStl(24, 32), { thumbnail: false, preview: true })
    expect(small.previewStl).toBeUndefined()

    const heavy = sphereStl(420, 500) // 420k triangles ≈ 21 MB, over both thresholds
    const { previewStl } = await generateVisualAssets(heavy, { thumbnail: false, preview: true })
    expect(previewStl).toBeDefined()
    expect(previewStl!.length).toBeLessThanOrEqual(Math.min(5_000_000, heavy.length * 0.45))
    const previewPositions = (await decodePreviewMesh(previewStl!))!
    expect(previewPositions.length).toBeGreaterThan(0)
    expect(previewPositions.length / 9).toBe(new DataView(heavy.buffer, heavy.byteOffset, heavy.byteLength).getUint32(80, true))
  }, 60_000)
})
