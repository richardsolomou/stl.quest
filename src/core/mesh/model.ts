import { isObj, parseObj } from './obj'
import { parseStl } from './stl'
import { isThreeMf, parseThreeMf } from './threeMf'

export function parseModelPositions(file: Uint8Array): Float32Array {
  if (isThreeMf(file)) return parseThreeMf(file)
  if (isObj(file)) return parseObj(file)
  return parseStl(file)
}
