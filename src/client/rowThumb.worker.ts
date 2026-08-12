import { expose, transfer } from 'comlink'
import { parseStl } from '../core/mesh/stl'
import { isThreeMf, parseThreeMf } from '../core/mesh/threeMf'
import { rasterize } from '../core/mesh/rasterize'

const api = {
  render(buffer: ArrayBuffer, size: number) {
    const file = new Uint8Array(buffer)
    const rgba = rasterize(isThreeMf(file) ? parseThreeMf(file) : parseStl(file), size)
    return transfer(rgba, [rgba.buffer])
  },
}

export type RowThumbWorker = typeof api
expose(api)
