import * as THREE from 'three'
import { STLExporter, STLLoader } from 'three-stdlib'

export function parseStl(file: Uint8Array): Float32Array {
  const binary = parseBinaryPositions(file)
  if (binary) return binary
  const buffer =
    file.byteOffset === 0 && file.byteLength === file.buffer.byteLength
      ? (file.buffer as ArrayBuffer)
      : (file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer)
  const geometry = new STLLoader().parse(buffer)
  const position = geometry.getAttribute('position')
  if (!position || position.count === 0) throw new Error('empty STL')
  geometry.center()
  return new Float32Array(position.array)
}

function parseBinaryPositions(file: Uint8Array): Float32Array | undefined {
  if (file.byteLength < 84) return undefined
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  const triangleCount = view.getUint32(80, true)
  if (84 + triangleCount * 50 !== file.byteLength) return undefined

  const positions = new Float32Array(triangleCount * 9)
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    let source = 84 + triangle * 50 + 12
    let target = triangle * 9
    for (let vertex = 0; vertex < 3; vertex++) {
      const x = view.getFloat32(source, true)
      const y = view.getFloat32(source + 4, true)
      const z = view.getFloat32(source + 8, true)
      positions[target++] = x
      positions[target++] = y
      positions[target++] = z
      source += 12
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
  }
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const centerZ = (minZ + maxZ) / 2
  for (let index = 0; index < positions.length; index += 3) {
    positions[index] -= centerX
    positions[index + 1] -= centerY
    positions[index + 2] -= centerZ
  }
  return positions
}

export function boundingExtent(positions: Float32Array) {
  const box = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(positions, 3))
  return box.getSize(new THREE.Vector3()).length()
}

export function exportBinaryStl(positions: Float32Array, indices: Uint32Array): Uint8Array {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  const mesh = new THREE.Mesh(geometry)
  mesh.updateMatrixWorld(true)
  const output = new STLExporter().parse(mesh, { binary: true })
  return new Uint8Array(output.buffer, output.byteOffset, output.byteLength)
}
