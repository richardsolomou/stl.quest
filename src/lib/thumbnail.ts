import * as THREE from 'three'
import { buildScene, frameCamera, parseStl } from './stl'

const SIZE = 256

/** Render a small PNG preview of an STL file; undefined if parsing/rendering fails. */
export async function renderStlThumbnail(file: File): Promise<string | undefined> {
  let renderer: THREE.WebGLRenderer | undefined
  try {
    const geometry = parseStl(await file.arrayBuffer())
    const { scene, mesh } = buildScene(geometry)
    const camera = new THREE.PerspectiveCamera(40, 1)
    frameCamera(camera, mesh)

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    renderer.setSize(SIZE, SIZE)
    renderer.render(scene, camera)
    const dataUrl = renderer.domElement.toDataURL('image/png')
    geometry.dispose()
    return dataUrl
  } catch {
    return undefined
  } finally {
    renderer?.dispose()
  }
}
