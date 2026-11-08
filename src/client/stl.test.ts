import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { STLLoader } from 'three-stdlib'
import { InvalidMeshError } from '../core/mesh/stl'
import { encodePreviewMesh } from '../core/mesh/previewMesh'
import { buildScene, parseStl } from './stl'

describe('client STL parser', () => {
  it('loads OBJ faces with renderable normals', async () => {
    const bytes = new TextEncoder().encode('o part\nv 0 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3\n')
    const geometry = await parseStl(bytes.buffer)
    expect({ positions: geometry.getAttribute('position').count, normals: geometry.getAttribute('normal').count }).toEqual({
      positions: 3,
      normals: 3,
    })
    geometry.dispose()
  })

  it('loads compressed previews with renderable face normals', async () => {
    const preview = await encodePreviewMesh(new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]), new Uint32Array([0, 1, 2]))
    const geometry = await parseStl(preview.buffer as ArrayBuffer)
    expect({ positions: geometry.getAttribute('position').count, normals: geometry.getAttribute('normal').count }).toEqual({
      positions: 3,
      normals: 3,
    })
    geometry.dispose()
  })

  it('loads a well-formed binary STL', async () => {
    const buffer = new ArrayBuffer(84 + 50)
    const view = new DataView(buffer)
    view.setUint32(80, 1, true)
    ;[0, 0, 0, 10, 0, 0, 0, 10, 0].forEach((value, index) => view.setFloat32(84 + 12 + index * 4, value, true))
    const geometry = await parseStl(buffer)
    expect(geometry.getAttribute('position').count).toBe(3)
    geometry.dispose()
  })

  it.each([
    ['too large to allocate', 0xffffffff],
    ['small enough to allocate', 0x0aaaaaaa],
  ])('rejects a binary STL header whose face count is %s before the loader allocates it', async (_, faces) => {
    // three-stdlib allocates Float32Array(faces * 9) from the header alone. A count just under the
    // browser limit makes it really try to reserve gigabytes, so the check must run first.
    const buffer = new ArrayBuffer(84)
    new DataView(buffer).setUint32(80, faces, true)
    const parse = vi.spyOn(STLLoader.prototype, 'parse')
    try {
      await expect(parseStl(buffer)).rejects.toBeInstanceOf(InvalidMeshError)
      expect(parse).not.toHaveBeenCalled()
    } finally {
      parse.mockRestore()
    }
  })

  it('uses flat shading instead of untrusted STL facet normals', () => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 10, 0, 0, 0, 10, 0], 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3))

    const { mesh } = buildScene(geometry)

    expect(mesh.material).toMatchObject({ color: new THREE.Color(0xa8a29a), flatShading: true, vertexColors: false })
    geometry.dispose()
    ;(mesh.material as THREE.Material).dispose()
  })
})
