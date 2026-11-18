import { wrap } from 'comlink'
import { modelFormat } from '../core/assetKeys'
import type { ThreeMfInspectionWorker } from './threeMfInspection.worker'
import type { ThreeMfInspection } from './threeMfFiles'

let worker: Worker | undefined

function inspector() {
  worker ??= new Worker(new URL('./threeMfInspection.worker.ts', import.meta.url), { type: 'module' })
  return wrap<ThreeMfInspectionWorker>(worker)
}

export async function inspectThreeMf(file: File): Promise<ThreeMfInspection | undefined> {
  if (modelFormat(file.name) !== '3mf') return undefined
  const result = await inspector().inspect(await file.arrayBuffer())
  return result ? { file, ...result } : undefined
}

export function cancelThreeMfInspections() {
  worker?.terminate()
  worker = undefined
}
