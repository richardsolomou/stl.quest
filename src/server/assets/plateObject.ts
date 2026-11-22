import fs from 'node:fs'
import { parseModelPositions } from '../../core/mesh/model'
import { plateMesh, threeMfObjectXml } from '../../core/mesh/threeMfWriter'

export type PlateObject = { id: number; name: string }
export type PlateFootprint = { width: number; depth: number }

/** Converts one model and appends it to a plate's model XML, returning the footprint its copies are laid out by. */
export function writePlateObject(file: Uint8Array, object: PlateObject, xmlPath: string): PlateFootprint {
  const mesh = plateMesh(parseModelPositions(file))
  const descriptor = fs.openSync(xmlPath, 'a')
  try {
    for (const chunk of threeMfObjectXml(object.id, object.name, mesh)) fs.writeSync(descriptor, chunk)
  } finally {
    fs.closeSync(descriptor)
  }
  return { width: mesh.width, depth: mesh.depth }
}
