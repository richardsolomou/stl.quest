import { expose, transfer } from 'comlink'
import { analyzePlateGeometry } from './plateGeometry'

const api = {
  async analyze(buffer: ArrayBuffer) {
    const { positions, normals } = await analyzePlateGeometry(new Uint8Array(buffer))
    return transfer({ positions, normals }, [positions.buffer, normals.buffer])
  },
}

export type PlateAnalysisWorker = typeof api
expose(api)
