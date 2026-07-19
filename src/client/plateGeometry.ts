import { decodePreviewMesh } from '../core/mesh/previewMesh'
import { parseStl } from '../core/mesh/stl'

export async function analyzePlateGeometry(file: Uint8Array) {
  const preview = await decodePreviewMesh(file)
  const positions = preview ?? parseStl(file)
  if (preview) centerPositions(positions)

  const normals = new Float32Array(positions.length)
  for (let index = 0; index < positions.length; index += 9) {
    const ax = positions[index]
    const ay = positions[index + 1]
    const az = positions[index + 2]
    const abx = positions[index + 3] - ax
    const aby = positions[index + 4] - ay
    const abz = positions[index + 5] - az
    const acx = positions[index + 6] - ax
    const acy = positions[index + 7] - ay
    const acz = positions[index + 8] - az
    const normalX = aby * acz - abz * acy
    const normalY = abz * acx - abx * acz
    const normalZ = abx * acy - aby * acx
    const length = Math.hypot(normalX, normalY, normalZ) || 1
    for (let vertex = 0; vertex < 3; vertex++) {
      normals[index + vertex * 3] = normalX / length
      normals[index + vertex * 3 + 1] = normalY / length
      normals[index + vertex * 3 + 2] = normalZ / length
    }
  }
  return { positions, normals }
}

function centerPositions(positions: Float32Array) {
  const minimum = [Infinity, Infinity, Infinity]
  const maximum = [-Infinity, -Infinity, -Infinity]
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis++) {
      minimum[axis] = Math.min(minimum[axis], positions[index + axis])
      maximum[axis] = Math.max(maximum[axis], positions[index + axis])
    }
  }
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis++) positions[index + axis] -= (minimum[axis] + maximum[axis]) / 2
  }
}
