import { expose, transfer } from 'comlink'
import { parseStl } from '../core/mesh/stl'

const api = {
  analyze(buffer: ArrayBuffer) {
    const positions = parseStl(new Uint8Array(buffer))
    const normals = new Float32Array(positions.length)
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    let maxZ = Number.NEGATIVE_INFINITY
    for (let index = 0; index < positions.length; index += 3) {
      const x = positions[index]
      const y = positions[index + 1]
      const z = positions[index + 2]
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      minZ = Math.min(minZ, z)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      maxZ = Math.max(maxZ, z)
    }
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
    return transfer({ positions, normals }, [positions.buffer, normals.buffer])
  },
}

export type PlateAnalysisWorker = typeof api
expose(api)
