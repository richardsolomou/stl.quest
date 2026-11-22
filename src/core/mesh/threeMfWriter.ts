import { InvalidMeshError } from './stl'

/**
 * The parts of a plain 3MF (core specification only) holding several models, each placed once per copy. Slicers that
 * did not write the file import it as geometry under their current settings: OrcaSlicer names each object after the
 * object's `name` and makes every build item of one object an object of its own, but when the file holds one object,
 * those extra copies take the file's name instead (see `plateFileName`).
 */

export const THREE_MF_CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'

export const THREE_MF_RELATIONSHIPS =
  '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'

/** A model as one indexed mesh, centred over the origin and standing on it, so a build item only has to move it. */
export type PlateMesh = { vertices: Float32Array; triangles: Uint32Array; width: number; depth: number }

/**
 * Indexes a triangle list, sharing corners at exactly the same position as STL readers do, so the slicer sees a
 * closed mesh rather than loose triangles; triangles that collapse to a line or point are dropped, and a model with none left is refused.
 */
export function plateMesh(positions: Float32Array): PlateMesh {
  const corners = positions.length / 3
  const bits = new Uint32Array(3)
  const floats = new Float32Array(bits.buffer)
  let vertices = new Float32Array(3 * 1024)
  let count = 0
  let slots = new Int32Array(1 << 12).fill(-1)
  // Round coordinates leave a float's low bits zero, so the bits are mixed before the table masks them.
  const hash = (x: number, y: number, z: number) => {
    let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
    return h ^ (h >>> 16)
  }
  const insert = (table: Int32Array, vertex: number) => {
    floats.set(vertices.subarray(vertex * 3, vertex * 3 + 3))
    let slot = hash(bits[0], bits[1], bits[2]) & (table.length - 1)
    while (table[slot] !== -1) slot = (slot + 1) & (table.length - 1)
    table[slot] = vertex
  }
  const vertexAt = (corner: number) => {
    // Adding zero turns -0 into 0, so both spellings of the origin share a vertex.
    floats[0] = positions[corner * 3] + 0
    floats[1] = positions[corner * 3 + 1] + 0
    floats[2] = positions[corner * 3 + 2] + 0
    if (!floats.every(Number.isFinite)) throw new InvalidMeshError('model has a vertex that is not a number')
    const [x, y, z] = bits
    let slot = hash(x, y, z) & (slots.length - 1)
    for (let found = slots[slot]; found !== -1; found = slots[slot]) {
      if (vertices[found * 3] === floats[0] && vertices[found * 3 + 1] === floats[1] && vertices[found * 3 + 2] === floats[2]) return found
      slot = (slot + 1) & (slots.length - 1)
    }
    if (count * 3 === vertices.length) {
      const grown = new Float32Array(vertices.length * 2)
      grown.set(vertices)
      vertices = grown
    }
    vertices.set(floats, count * 3)
    slots[slot] = count
    if (++count * 2 > slots.length) {
      slots = new Int32Array(slots.length * 2).fill(-1)
      for (let vertex = 0; vertex < count; vertex++) insert(slots, vertex)
    }
    return count - 1
  }
  const triangles = new Uint32Array(corners)
  let kept = 0
  for (let corner = 0; corner + 2 < corners; corner += 3) {
    const a = vertexAt(corner)
    const b = vertexAt(corner + 1)
    const c = vertexAt(corner + 2)
    if (a === b || b === c || a === c) continue
    triangles[kept++] = a
    triangles[kept++] = b
    triangles[kept++] = c
  }
  // The 3MF core specification requires at least one triangle per mesh.
  if (!kept) throw new InvalidMeshError('model has no triangle with any area')
  vertices = vertices.slice(0, count * 3)
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let index = 0; index < vertices.length; index++) {
    const axis = index % 3
    if (vertices[index] < min[axis]) min[axis] = vertices[index]
    if (vertices[index] > max[axis]) max[axis] = vertices[index]
  }
  const offset = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]]
  for (let index = 0; index < vertices.length; index++) vertices[index] -= offset[index % 3]
  return { vertices, triangles: triangles.slice(0, kept), width: max[0] - min[0], depth: max[1] - min[1] }
}

/**
 * Where each footprint's centre goes: rows filled left to right up to roughly a square's width, `gap` apart and clear
 * of the bed's edges. Slicers re-centre an imported plate on their own bed, so this only keeps the copies apart.
 */
export function arrangeFootprints(footprints: { width: number; depth: number }[], gap: number) {
  const area = footprints.reduce((total, { width, depth }) => total + (width + gap) * (depth + gap), 0)
  const rowWidth = Math.max(Math.sqrt(area), ...footprints.map(({ width }) => width))
  const placed: { x: number; y: number }[] = []
  let x = gap
  let y = gap
  let rowDepth = 0
  for (const { width, depth } of footprints) {
    if (x > gap && x + width > gap + rowWidth) {
      x = gap
      y += rowDepth + gap
      rowDepth = 0
    }
    placed.push({ x: x + width / 2, y: y + depth / 2 })
    x += width + gap
    rowDepth = Math.max(rowDepth, depth)
  }
  return placed
}

export function threeMfModelStart() {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
    '<metadata name="Application">STL Quest</metadata><resources>'
  )
}

const CHUNK_ENTRIES = 4096

/** One object's XML, a few thousand vertices or triangles at a time, so a large model never sits in memory as text. */
export function* threeMfObjectXml(id: number, name: string, mesh: PlateMesh): Generator<string> {
  yield `<object id="${id}" name="${escapeAttribute(name)}" type="model"><mesh><vertices>`
  const { vertices, triangles } = mesh
  for (let start = 0; start < vertices.length; start += CHUNK_ENTRIES * 3) {
    let chunk = ''
    for (let index = start; index < Math.min(vertices.length, start + CHUNK_ENTRIES * 3); index += 3)
      chunk += `<vertex x="${coordinate(vertices[index])}" y="${coordinate(vertices[index + 1])}" z="${coordinate(vertices[index + 2])}"/>`
    yield chunk
  }
  yield '</vertices><triangles>'
  for (let start = 0; start < triangles.length; start += CHUNK_ENTRIES * 3) {
    let chunk = ''
    for (let index = start; index < Math.min(triangles.length, start + CHUNK_ENTRIES * 3); index += 3)
      chunk += `<triangle v1="${triangles[index]}" v2="${triangles[index + 1]}" v3="${triangles[index + 2]}"/>`
    yield chunk
  }
  yield '</triangles></mesh></object>'
}

export function threeMfBuildXml(items: { objectId: number; x: number; y: number }[]) {
  const placed = items.map(
    ({ objectId, x, y }) => `<item objectid="${objectId}" transform="1 0 0 0 1 0 0 0 1 ${coordinate(x)} ${coordinate(y)} 0"/>`,
  )
  return `</resources><build>${placed.join('')}</build>`
}

export function threeMfModelEnd() {
  return '</model>'
}

/** Millimetres to a hundredth of a micron, well inside what a 32-bit float holds at bed scale. */
function coordinate(value: number) {
  return String(Math.round(value * 100_000) / 100_000)
}

function escapeAttribute(value: string) {
  // XML 1.0 cannot carry most control characters even escaped, and a name has no use for any of them.
  return value
    .replace(/\p{Cc}/gu, '')
    .replace(/[&<>"']/g, (char) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": 'apos' }[char]};`)
}
