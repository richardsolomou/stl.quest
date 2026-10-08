import * as THREE from 'three'
import { STLExporter, STLLoader } from 'three-stdlib'

// Raised when mesh input cannot be parsed: a truncated or corrupt STL, or a file
// that holds no geometry. It marks bad user input rather than a server fault, so the
// asset queue records a controlled failure instead of reporting an exception.
export class InvalidMeshError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'InvalidMeshError'
  }
}

export function parseStl(file: Uint8Array): Float32Array {
  const binary = parseBinaryPositions(file)
  if (binary) return binary
  if (isAsciiStl(file)) return parseAsciiPositions(file)
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
    // binary rather than text: a truncated or corrupt binary STL. Fail with a controlled error
    // instead of letting a DataView read run off the buffer end and throw a bare RangeError.
    if (expected > file.byteLength && hasControlBytes(file)) throw new InvalidMeshError('invalid or truncated binary STL')
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

// three-stdlib's STLLoader decodes a whole ASCII STL into one string and gathers coordinates in
// number arrays, which costs about 5x the file size in memory and fails outright past V8's maximum
// string length. This finds the same solid and facet spans as the loader's regular expressions by
// scanning bytes, decodes one facet at a time, and keeps positions in a typed array, so the output
// matches the loader's exactly.
const SOLID = keyword('solid', 'i')
const END_SOLID = keyword('endsolid', 'i')
const FACET = keyword('facet', 'f')
const END_FACET = keyword('endfacet', 'f')
const STL_FLOAT = /[\s]+([+-]?(?:\d*)(?:\.\d*)?(?:[eE][+-]?\d+)?)/.source
const STL_VERTEX = new RegExp(`vertex${STL_FLOAT}${STL_FLOAT}${STL_FLOAT}`, 'g')
// "vertex" and three separators: the fewest bytes that can yield one vertex.
const MIN_VERTEX_BYTES = 9
const MAX_FACET_BYTES = 1 << 20

function keyword(text: string, anchor: string) {
  return { bytes: new TextEncoder().encode(text), anchor: text.indexOf(anchor) }
}

// Same test as STLLoader: a text STL whose size doesn't match a binary header names its solid within the first bytes.
function isAsciiStl(file: Uint8Array) {
  if (file.byteLength < 84) return false
  for (let offset = 0; offset < 5; offset++) if (startsWith(file, SOLID.bytes, offset)) return true
  return false
}

function parseAsciiPositions(file: Uint8Array): Float32Array {
  const decoder = new TextDecoder()
  const maxValues = Math.floor(file.byteLength / MIN_VERTEX_BYTES) * 3
  let positions = new Float32Array(Math.min(maxValues, 3 * 1024))
  let length = 0
  for (let solid = find(file, SOLID, 0, file.length); solid >= 0;) {
    const endSolid = find(file, END_SOLID, solid + SOLID.bytes.length, file.length)
    if (endSolid < 0) break
    const solidEnd = endSolid + END_SOLID.bytes.length
    for (let facet = find(file, FACET, solid, solidEnd); facet >= 0;) {
      const endFacet = find(file, END_FACET, facet + FACET.bytes.length, solidEnd)
      if (endFacet < 0) break
      const facetEnd = endFacet + END_FACET.bytes.length
      if (facetEnd - facet > MAX_FACET_BYTES) throw new InvalidMeshError('STL facet too long')
      for (const match of decoder.decode(file.subarray(facet, facetEnd)).matchAll(STL_VERTEX)) {
        if (length === positions.length) {
          const grown = new Float32Array(Math.min(positions.length * 2, maxValues))
          grown.set(positions)
          positions = grown
        }
        positions[length++] = Number.parseFloat(match[1])
        positions[length++] = Number.parseFloat(match[2])
        positions[length++] = Number.parseFloat(match[3])
      }
      facet = find(file, FACET, facetEnd, solidEnd)
    }
    solid = find(file, SOLID, solidEnd, file.length)
  }
  if (!length) throw new InvalidMeshError('empty STL')
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(length === positions.length ? positions : positions.slice(0, length), 3))
  geometry.center()
  return geometry.getAttribute('position').array as Float32Array
}

// Finds a keyword by scanning for one of its letters that rarely appears elsewhere in STL text.
function find(file: Uint8Array, { bytes, anchor }: ReturnType<typeof keyword>, from: number, to: number) {
  for (let index = file.indexOf(bytes[anchor], from + anchor); index >= 0; index = file.indexOf(bytes[anchor], index + 1)) {
    const start = index - anchor
    if (start + bytes.length > to) return -1
    if (startsWith(file, bytes, start)) return start
  }
  return -1
}

function startsWith(file: Uint8Array, bytes: Uint8Array, offset: number) {
  for (let index = 0; index < bytes.length; index++) if (file[offset + index] !== bytes[index]) return false
  return true
}

// Binary STL floats and attribute counts are full of control bytes such as zero, while an ASCII
// STL is text that may still hold UTF-8 (a solid name, a byte order mark) but no control bytes
// besides whitespace. Bytes above the ASCII range therefore cannot tell the two apart.
function hasControlBytes(file: Uint8Array): boolean {
  for (let index = 0; index < file.byteLength; index++) {
    const byte = file[index]
    if ((byte < 0x20 && (byte < 0x09 || byte > 0x0d)) || byte === 0x7f) return true
  }
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
