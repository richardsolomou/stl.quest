import { InvalidMeshError } from './stl'

// Decoding a whole OBJ into one string (as three-stdlib's OBJLoader does) costs about 20x the
// file size in heap and fails outright past V8's maximum string length, so the parser walks
// bounded chunks that end on a line break and keeps geometry in typed arrays.
const CHUNK_BYTES = 1 << 20
const MAX_LINE_BYTES = 1 << 20
const LINE_FEED = 0x0a
const CARRIAGE_RETURN = 0x0d
const BACKSLASH = 0x5c

export function isObj(file: Uint8Array) {
  return /^v[ \t]+[-+\d.]/m.test(new TextDecoder().decode(file.subarray(0, 65_536)))
}

export function parseObj(file: Uint8Array): Float32Array {
  let vertices = new Float32Array(3 * 1024)
  let corners = new Uint32Array(3 * 1024)
  let vertexCount = 0
  let cornerCount = 0
  const resolve = (reference: string) => {
    const index = Number.parseInt(reference, 10)
    const resolved = index > 0 ? index - 1 : vertexCount + index
    if (!Number.isInteger(index) || index === 0 || resolved < 0 || resolved >= vertexCount)
      throw new InvalidMeshError('invalid OBJ face index')
    return resolved
  }
  for (const fields of objRecords(file)) {
    if (fields[0] === 'v') {
      if (vertexCount * 3 === vertices.length) vertices = grow(vertices)
      vertices[vertexCount * 3] = Number.parseFloat(fields[1])
      vertices[vertexCount * 3 + 1] = Number.parseFloat(fields[2])
      vertices[vertexCount * 3 + 2] = Number.parseFloat(fields[3])
      vertexCount++
    } else if (fields.length > 3) {
      const first = resolve(fields[1])
      let previous = resolve(fields[2])
      for (let corner = 3; corner < fields.length; corner++) {
        const current = resolve(fields[corner])
        if (cornerCount === corners.length) corners = grow(corners)
        corners[cornerCount++] = first
        corners[cornerCount++] = previous
        corners[cornerCount++] = current
        previous = current
      }
    }
  }
  if (!cornerCount) throw new InvalidMeshError('empty OBJ')

  const positions = new Float32Array(cornerCount * 3)
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let index = 0; index < positions.length; index++) {
    const value = vertices[corners[Math.floor(index / 3)] * 3 + (index % 3)]
    if (!Number.isFinite(value)) throw new InvalidMeshError('invalid OBJ vertex')
    positions[index] = value
    if (value < min[index % 3]) min[index % 3] = value
    if (value > max[index % 3]) max[index % 3] = value
  }
  for (let index = 0; index < positions.length; index++) positions[index] -= (min[index % 3] + max[index % 3]) / 2
  return positions
}

function grow<T extends Float32Array | Uint32Array>(values: T): T {
  const next = new (values.constructor as new (length: number) => T)(values.length * 2)
  next.set(values)
  return next
}

function* objRecords(file: Uint8Array): Generator<string[]> {
  const decoder = new TextDecoder()
  for (let start = 0; start < file.length;) {
    let end = Math.min(file.length, start + CHUNK_BYTES)
    while (end < file.length && !endsLine(file, end)) {
      if (++end - start > CHUNK_BYTES + MAX_LINE_BYTES) throw new InvalidMeshError('OBJ line too long')
    }
    const text = decoder.decode(file.subarray(start, end)).replace(/\\(?:\r\n|\r|\n)/g, ' ')
    for (const line of text.split(/\r\n|\r|\n/)) {
      const fields = line.trim().split(/\s+/)
      if (fields[0] === 'v' || fields[0] === 'f') yield fields
    }
    start = end
  }
}

function endsLine(file: Uint8Array, end: number) {
  const last = file[end - 1]
  return (last === LINE_FEED || last === CARRIAGE_RETURN) && file[end - 2] !== BACKSLASH
}
