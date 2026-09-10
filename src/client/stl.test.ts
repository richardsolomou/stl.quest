import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { InvalidMeshError } from '../core/mesh/stl'
import { encodePreviewMesh } from '../core/mesh/previewMesh'
import { buildScene, parseStl } from './stl'

describe('client STL parser', () => {
  it('loads compressed previews with renderable face normals', async () => {
    const preview = await encodePreviewMesh(new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]), new Uint32Array([0, 1, 2]))
    const geometry = await parseStl(preview.buffer as ArrayBuffer)
    expect({ positions: geometry.getAttribute('position').count, normals: geometry.getAttribute('normal').count }).toEqual({
      positions: 3,
      normals: 3,
    })
    geometry.dispose()
  })

  it('reports a corrupt binary STL as an InvalidMeshError instead of a bare RangeError', async () => {
    // A binary STL header whose 32-bit face count is garbage: three-stdlib allocates
    // Float32Array(faces * 9) and throws a bare RangeError, which the viewer would offer to
    // retry forever. The guard must turn it into a terminal InvalidMeshError.
    const buffer = new ArrayBuffer(84)
    new DataView(buffer).setUint32(80, 0xffffffff, true)
    const caught = await parseStl(buffer).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(caught).toBeInstanceOf(InvalidMeshError)
    expect((caught as InvalidMeshError).cause).toBeInstanceOf(RangeError)
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
