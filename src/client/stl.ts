import * as THREE from 'three'
import { STLLoader } from 'three-stdlib'
import { decodePreviewMesh } from '../core/mesh/previewMesh'

export async function parseStl(buffer: ArrayBuffer): Promise<THREE.BufferGeometry> {
  const preview = await decodePreviewMesh(new Uint8Array(buffer))
  if (preview) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(preview, 3))
    geometry.center()
    geometry.computeVertexNormals()
    return geometry
  }
  const geometry = new STLLoader().parse(buffer)
  geometry.center()
  // STLs carry face normals; recomputing costs seconds on large meshes.
  if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals()
  return geometry
}

const MODEL_MATERIAL_PROPS = {
  color: 0xa8a29a,
  roughness: 0.55,
  metalness: 0.05,
} as const

export function buildScene(geometry: THREE.BufferGeometry): { scene: THREE.Scene; mesh: THREE.Mesh } {
  const scene = new THREE.Scene()
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial(MODEL_MATERIAL_PROPS))
  // STLs are usually Z-up; three is Y-up.
  mesh.rotation.x = -Math.PI / 2
  scene.add(mesh)
  scene.add(new THREE.HemisphereLight(0xe8e4d8, 0x262a33, 1.1))
  const key = new THREE.DirectionalLight(0xfaf3e8, 1.4)
  key.position.set(1, 1.5, 1)
  scene.add(key)
  return { scene, mesh }
}

export function frameCamera(camera: THREE.PerspectiveCamera, mesh: THREE.Mesh): void {
  const sphere = new THREE.Box3().setFromObject(mesh).getBoundingSphere(new THREE.Sphere())
  const distance = (sphere.radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.15
  camera.position.set(sphere.center.x + distance * 0.6, sphere.center.y + distance * 0.5, sphere.center.z + distance * 0.65)
  camera.lookAt(sphere.center)
  camera.near = distance / 100
  camera.far = distance * 10
  camera.updateProjectionMatrix()
}
