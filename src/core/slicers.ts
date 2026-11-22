import type { PrintType } from './types'

/**
 * The slicers a printer can hand its files to. `openUrl` is set only for a slicer whose URL scheme downloads a file
 * from any host and opens it: OrcaSlicer takes `orcaslicer://open?file=<encoded URL>` and saves the file under the name
 * the server's Content-Disposition gives when the URL's last segment has no extension. Bambu Studio and PrusaSlicer only
 * download from their own marketplaces, and the others document no file-open scheme, so their files are downloaded.
 */
const SLICER_LIST = [
  { id: 'bambu-studio', name: 'Bambu Studio', printTypes: ['filament'] },
  {
    id: 'orcaslicer',
    name: 'OrcaSlicer',
    printTypes: ['filament'],
    openUrl: (fileUrl: string) => `orcaslicer://open?file=${encodeURIComponent(fileUrl)}`,
  },
  { id: 'prusaslicer', name: 'PrusaSlicer', printTypes: ['filament'] },
  { id: 'cura', name: 'UltiMaker Cura', printTypes: ['filament'] },
  { id: 'chitubox', name: 'CHITUBOX', printTypes: ['resin'] },
  { id: 'lychee', name: 'Lychee Slicer', printTypes: ['resin'] },
  { id: 'preform', name: 'PreForm', printTypes: ['resin'] },
  { id: 'heygears-blueprint', name: 'HeyGears Blueprint', printTypes: ['resin'] },
  { id: 'elegoo-satellite', name: 'ELEGOO SatelLite', printTypes: ['resin'] },
  { id: 'anycubic-photon-workshop', name: 'Anycubic Photon Workshop', printTypes: ['resin'] },
  { id: 'dragonfruit', name: 'DragonFruit', printTypes: ['resin'] },
] as const satisfies readonly { id: string; name: string; printTypes: readonly PrintType[]; openUrl?: (fileUrl: string) => string }[]

export type SlicerId = (typeof SLICER_LIST)[number]['id']
export type Slicer = { id: SlicerId; name: string; printTypes: readonly PrintType[]; openUrl?: (fileUrl: string) => string }
export const SLICERS: readonly Slicer[] = SLICER_LIST
export const SLICER_IDS = SLICER_LIST.map(({ id }) => id) as [SlicerId, ...SlicerId[]]

export function getSlicer(id: string | undefined) {
  return SLICERS.find((slicer) => slicer.id === id)
}

export function slicersFor(printType: PrintType) {
  return SLICERS.filter((slicer) => slicer.printTypes.includes(printType))
}

export function isSlicerFor(id: string, printType: PrintType) {
  return getSlicer(id)?.printTypes.includes(printType) ?? false
}

/** Where a printer's file goes: the material's own slicer when it set one for that printer's print type, else the printer's. */
export function resolvedSlicer(printer: { printType: PrintType; slicer?: string } | undefined, material?: { slicer?: string }) {
  if (!printer) return undefined
  const id = material?.slicer && isSlicerFor(material.slicer, printer.printType) ? material.slicer : printer.slicer
  return id && isSlicerFor(id, printer.printType) ? getSlicer(id) : undefined
}
