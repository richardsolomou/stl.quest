import { expose, transfer } from 'comlink'
import { parseModelPositions } from '../core/mesh/model'
import { rasterize } from '../core/mesh/rasterize'

const api = {
  render(buffer: ArrayBuffer, size: number) {
    const file = new Uint8Array(buffer)
    const rgba = rasterize(parseModelPositions(file), size)
    return transfer(rgba, [rgba.buffer])
  },
}

export type RowThumbWorker = typeof api
expose(api)
