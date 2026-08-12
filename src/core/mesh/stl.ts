import * as THREE from 'three'
import { STLExporter, STLLoader } from 'three-stdlib'

// Raised when mesh input cannot be parsed: a truncated or corrupt STL, or a file
// that holds no geometry. It marks bad user input rather than a server fault, so the
// asset queue records a controlled failure instead of reporting an exception.
export class InvalidMeshError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidMeshError'
  }
}

export function parseStl(file: Uint8Array): Float32Array {
  const binary = parseBinaryPositions(file)
  if (binary) return binary
  const buffer =
    file.byteOffset === 0 && file.byteLength === file.buffer.byteLength
      ? (file.buffer as ArrayBuffer)
      : (file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer)
  let geometry: THREE.BufferGeometry
  try {
    geometry = new STLLoader().parse(buffer)
  } catch {
    // three-stdlib reads the header with a DataView and throws a bare RangeError on a
    // short or corrupt buffer. Report it as invalid input, not a server fault.
    throw new InvalidMeshError('could not parse STL')
  }
  const position = geometry.getAttribute('position')
  if (!position || position.count === 0) throw new InvalidMeshError('empty STL')
  geometry.center()
  return new Float32Array(position.array)
}

function parseBinaryPositions(file: Uint8Array): Float32Array | undefined {
  if (file.byteLength < 84) return undefined
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  const triangleCount = view.getUint32(80, true)
  const expected = 84 + triangleCount * 50
  if (expected !== file.byteLength) {
    // The header declares more triangle data than the buffer holds, yet the bytes are
    // binary (non-ASCII): a truncated or corrupt binary STL. Fail with a controlled error
    // instead of letting a DataView read run off the buffer end and throw a bare RangeError.
    if (expected > file.byteLength && hasNonAsciiBytes(file)) throw new InvalidMeshError('invalid or truncated binary STL')
    return undefined
  }

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

// A binary STL stores 32-bit floats, so it holds bytes above the ASCII range; an ASCII STL
// is printable text. This mirrors three-stdlib's own binary/ASCII heuristic, so a size
// mismatch on a text STL still falls through to the text parser rather than being rejected.
function hasNonAsciiBytes(file: Uint8Array): boolean {
  for (let index = 0; index < file.byteLength; index++) if (file[index] > 127) return true
  return false
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
