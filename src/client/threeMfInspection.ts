import { wrap } from 'comlink'
import type { ThreeMfInspectionWorker } from './threeMfInspection.worker'
import type { ThreeMfInspection } from './threeMfFiles'

let worker: Worker | undefined

function inspector() {
  worker ??= new Worker(new URL('./threeMfInspection.worker.ts', import.meta.url), { type: 'module' })
  return wrap<ThreeMfInspectionWorker>(worker)
}

export async function inspectThreeMf(file: File): Promise<ThreeMfInspection | undefined> {
  if (!file.name.toLowerCase().endsWith('.3mf')) return undefined
  const result = await inspector().inspect(await file.arrayBuffer())
  return result ? { file, ...result } : undefined
}
