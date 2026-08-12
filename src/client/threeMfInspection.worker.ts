import { expose } from 'comlink'
import { inspectThreeMfBytes } from './threeMfFiles'

const api = {
  inspect(buffer: ArrayBuffer) {
    return inspectThreeMfBytes(new Uint8Array(buffer))
  },
}

export type ThreeMfInspectionWorker = typeof api
expose(api)
