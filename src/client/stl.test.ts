import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
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
