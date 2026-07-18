import { transfer, wrap } from 'comlink'
import type { PlatePlacement } from '../core/platePlanner'
import type { DragonFruitPlate } from '../core/mesh/voxl'
import type { PlateExportModel, PlateExportWorker } from './plateExport.worker'

let worker: Worker | undefined
let api: ReturnType<typeof wrap<PlateExportWorker>> | undefined

export function exportPlate3mf(placements: PlatePlacement[], models: PlateExportModel[]) {
  worker ??= new Worker(new URL('./plateExport.worker.ts', import.meta.url), { type: 'module' })
  api ??= wrap<PlateExportWorker>(worker)
  return api.exportPlate3mf(
    placements,
    transfer(
      models,
      models.map((model) => model.buffer),
    ),
  )
}

export function exportPlateVoxl(placements: PlatePlacement[], models: PlateExportModel[], plate: DragonFruitPlate) {
  worker ??= new Worker(new URL('./plateExport.worker.ts', import.meta.url), { type: 'module' })
  api ??= wrap<PlateExportWorker>(worker)
  return api.exportPlateVoxl(
    placements,
    transfer(
      models,
      models.map((model) => model.buffer),
    ),
    plate,
  )
}
