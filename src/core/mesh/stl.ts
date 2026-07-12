// Minimal STL codec for the asset pipeline: positions in, positions out,
// no scene-graph dependency. Positions are 9 floats per triangle.

export function parseStl(file: Uint8Array): Float32Array {
  const positions = looksBinary(file) ? parseBinary(file) : parseAscii(file)
  if (positions.length === 0) throw new Error('empty STL')
  center(positions)
  return positions
}

// The reliable binary test is structural: header + count matching the byte
// length. ASCII files that happen to start with "solid" pass through here.
function looksBinary(file: Uint8Array) {
  if (file.byteLength < 84) return false
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  const triangles = view.getUint32(80, true)
  return 84 + triangles * 50 === file.byteLength
}

function parseBinary(file: Uint8Array): Float32Array {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  const triangles = view.getUint32(80, true)
  const positions = new Float32Array(triangles * 9)
  for (let index = 0; index < triangles; index++) {
    const base = 84 + index * 50 + 12
    for (let component = 0; component < 9; component++) {
      positions[index * 9 + component] = view.getFloat32(base + component * 4, true)
    }
  }
  return positions
}

function parseAscii(file: Uint8Array): Float32Array {
  const text = new TextDecoder().decode(file)
  const values: number[] = []
  const vertex = /vertex\s+([-+.eE\d]+)\s+([-+.eE\d]+)\s+([-+.eE\d]+)/g
  for (let match = vertex.exec(text); match; match = vertex.exec(text)) {
    values.push(Number(match[1]), Number(match[2]), Number(match[3]))
  }
  if (values.length % 9 !== 0) throw new Error('malformed ascii STL')
  return new Float32Array(values)
}

function center(positions: Float32Array) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[index + axis]
      if (value < min[axis]) min[axis] = value
      if (value > max[axis]) max[axis] = value
    }
  }
  const offset = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  for (let index = 0; index < positions.length; index += 3) {
    positions[index] -= offset[0]
    positions[index + 1] -= offset[1]
    positions[index + 2] -= offset[2]
  }
}

export function boundingExtent(positions: Float32Array) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[index + axis]
      if (value < min[axis]) min[axis] = value
      if (value > max[axis]) max[axis] = value
    }
  }
  return Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2])
}

/** Binary STL from indexed geometry, face normals recomputed. */
export function exportBinaryStl(positions: Float32Array, indices: Uint32Array): Uint8Array {
  const triangles = indices.length / 3
  const output = new Uint8Array(84 + triangles * 50)
  const view = new DataView(output.buffer)
  view.setUint32(80, triangles, true)
  for (let triangle = 0; triangle < triangles; triangle++) {
    const base = 84 + triangle * 50
    const a = indices[triangle * 3] * 3
    const b = indices[triangle * 3 + 1] * 3
    const c = indices[triangle * 3 + 2] * 3
    const ux = positions[b] - positions[a]
    const uy = positions[b + 1] - positions[a + 1]
    const uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a]
    const vy = positions[c + 1] - positions[a + 1]
    const vz = positions[c + 2] - positions[a + 2]
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const length = Math.hypot(nx, ny, nz) || 1
    nx /= length
    ny /= length
    nz /= length
    view.setFloat32(base, nx, true)
    view.setFloat32(base + 4, ny, true)
    view.setFloat32(base + 8, nz, true)
    for (const [corner, offset] of [[a, 12], [b, 24], [c, 36]] as const) {
      view.setFloat32(base + offset, positions[corner], true)
      view.setFloat32(base + offset + 4, positions[corner + 1], true)
      view.setFloat32(base + offset + 8, positions[corner + 2], true)
    }
  }
  return output
}
