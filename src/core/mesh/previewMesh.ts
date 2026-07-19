import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'

const LEGACY_MAGIC = 0x50484d31
const MAGIC = 0x50484d32
const LEGACY_HEADER_BYTES = 32
const HEADER_BYTES = 44
const VERTEX_STRIDE = 8

export async function encodePreviewMesh(positions: Float32Array, indices: Uint32Array): Promise<Uint8Array> {
  if (indices.length % 3 !== 0) throw new Error('preview mesh indices must contain triangles')
  if (indices.length === 0) throw new Error('preview mesh must contain triangles')

  const bounds = meshBounds(positions, indices)
  const vertexMap = new Map<number, number>()
  const vertexRecords: number[][] = []
  const indexedTriangles = new Uint32Array(indices.length)
  for (let target = 0; target < indices.length; target++) {
    const source = indices[target]
    if (source * 3 + 2 >= positions.length) throw new Error('preview mesh index is out of bounds')
    const quantized = [0, 1, 2].map((axis) => {
      const minimum = bounds[axis]
      const extent = bounds[axis + 3] - minimum
      return extent === 0 ? 0 : Math.round(((positions[source * 3 + axis] - minimum) / extent) * 65_535)
    })
    const key = quantized[0] * 4_294_967_296 + quantized[1] * 65_536 + quantized[2]
    let vertex = vertexMap.get(key)
    if (vertex === undefined) {
      vertex = vertexMap.size
      vertexMap.set(key, vertex)
      vertexRecords.push(quantized)
    }
    indexedTriangles[target] = vertex
  }

  const vertices = new Uint8Array(vertexRecords.length * VERTEX_STRIDE)
  const vertexView = new DataView(vertices.buffer)
  for (let vertex = 0; vertex < vertexRecords.length; vertex++) {
    for (let axis = 0; axis < 3; axis++) vertexView.setUint16(vertex * VERTEX_STRIDE + axis * 2, vertexRecords[vertex][axis], true)
  }

  await MeshoptEncoder.ready
  const encodedVertices = MeshoptEncoder.encodeVertexBuffer(vertices, vertexRecords.length, VERTEX_STRIDE)
  const encodedIndices = MeshoptEncoder.encodeIndexBuffer(new Uint8Array(indexedTriangles.buffer), indexedTriangles.length, 4)
  const output = new Uint8Array(HEADER_BYTES + encodedVertices.length + encodedIndices.length)
  const view = new DataView(output.buffer)
  view.setUint32(0, MAGIC)
  view.setUint32(4, indices.length / 3, true)
  view.setUint32(8, vertexRecords.length, true)
  view.setUint32(12, encodedVertices.length, true)
  view.setUint32(16, encodedIndices.length, true)
  for (let axis = 0; axis < bounds.length; axis++) view.setFloat32(20 + axis * 4, bounds[axis], true)
  output.set(encodedVertices, HEADER_BYTES)
  output.set(encodedIndices, HEADER_BYTES + encodedVertices.length)
  return output
}

export async function decodePreviewMesh(file: Uint8Array): Promise<Float32Array | undefined> {
  if (file.byteLength < LEGACY_HEADER_BYTES) return undefined
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  const magic = view.getUint32(0)
  if (magic === LEGACY_MAGIC) return decodeLegacyPreviewMesh(file, view)
  if (magic !== MAGIC) return undefined
  if (file.byteLength < HEADER_BYTES) throw new Error('invalid preview mesh length')

  const triangleCount = view.getUint32(4, true)
  const vertexCount = view.getUint32(8, true)
  const vertexBytes = view.getUint32(12, true)
  const indexBytes = view.getUint32(16, true)
  if (!triangleCount || !vertexCount || HEADER_BYTES + vertexBytes + indexBytes !== file.byteLength) {
    throw new Error('invalid preview mesh length')
  }
  const bounds = previewBounds(view, 20)
  const vertices = new Uint8Array(vertexCount * VERTEX_STRIDE)
  const indices = new Uint8Array(triangleCount * 3 * 4)
  await MeshoptDecoder.ready
  MeshoptDecoder.decodeVertexBuffer(vertices, vertexCount, VERTEX_STRIDE, file.subarray(HEADER_BYTES, HEADER_BYTES + vertexBytes))
  MeshoptDecoder.decodeIndexBuffer(indices, triangleCount * 3, 4, file.subarray(HEADER_BYTES + vertexBytes))

  const vertexView = new DataView(vertices.buffer)
  const indexView = new DataView(indices.buffer)
  const positions = new Float32Array(triangleCount * 9)
  for (let target = 0; target < triangleCount * 3; target++) {
    const vertex = indexView.getUint32(target * 4, true)
    if (vertex >= vertexCount) throw new Error('invalid preview mesh index')
    for (let axis = 0; axis < 3; axis++) {
      const minimum = bounds[axis]
      const extent = bounds[axis + 3] - minimum
      positions[target * 3 + axis] = minimum + (vertexView.getUint16(vertex * VERTEX_STRIDE + axis * 2, true) / 65_535) * extent
    }
  }
  return positions
}

function meshBounds(positions: Float32Array, indices: Uint32Array): number[] {
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (const index of indices) {
    if (index * 3 + 2 >= positions.length) throw new Error('preview mesh index is out of bounds')
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[index * 3 + axis]
      if (value < bounds[axis]) bounds[axis] = value
      if (value > bounds[axis + 3]) bounds[axis + 3] = value
    }
  }
  return bounds
}

function previewBounds(view: DataView, offset: number): number[] {
  const bounds = Array.from({ length: 6 }, (_, axis) => view.getFloat32(offset + axis * 4, true))
  for (let axis = 0; axis < 3; axis++) {
    if (!Number.isFinite(bounds[axis]) || !Number.isFinite(bounds[axis + 3]) || bounds[axis] > bounds[axis + 3]) {
      throw new Error('invalid preview mesh bounds')
    }
  }
  return bounds
}

function decodeLegacyPreviewMesh(file: Uint8Array, view: DataView): Float32Array {
  const triangleCount = view.getUint32(4, true)
  if (LEGACY_HEADER_BYTES + triangleCount * 18 !== file.byteLength) throw new Error('invalid preview mesh length')
  const bounds = previewBounds(view, 8)
  const positions = new Float32Array(triangleCount * 9)
  let offset = LEGACY_HEADER_BYTES
  for (let index = 0; index < positions.length; index++) {
    const axis = index % 3
    const minimum = bounds[axis]
    const extent = bounds[axis + 3] - minimum
    positions[index] = minimum + (view.getUint16(offset, true) / 65_535) * extent
    offset += 2
  }
  return positions
}
