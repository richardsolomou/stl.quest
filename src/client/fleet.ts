import type { Messages } from '../core/i18n'
import { PRINT_TYPES, type PrintType } from '../core/types'

/** The types a print can be given: what the workspace prints, plus the type it already has so it stays valid. */
export function requestPrintTypeChoices(printTypes: readonly PrintType[], current?: PrintType) {
  return PRINT_TYPES.filter((printType) => printTypes.includes(printType) || printType === current)
}

export function printTypeLabel(t: Messages, printType: PrintType) {
  return t.board.printType[printType]
}
