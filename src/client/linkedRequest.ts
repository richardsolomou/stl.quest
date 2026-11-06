import type { Messages } from '../core/i18n'
import type { PrintType } from '../core/types'
import {
  MAX_REQUEST_NAME_LENGTH,
  MAX_REQUEST_NOTES_LENGTH,
  MAX_REQUEST_QUANTITY,
  MIN_REQUEST_QUANTITY,
  validSourceUrl,
} from '../core/request'

export type LinkedRequestValues = {
  name: string
  quantity: string
  notes: string
  sourceUrl: string
  printType: PrintType | ''
}

export function linkedRequestValues(printType: PrintType | undefined): LinkedRequestValues {
  return { name: '', quantity: '1', notes: '', sourceUrl: '', printType: printType ?? '' }
}

export function linkedRequestDirty(values: LinkedRequestValues) {
  return Boolean(values.name || values.notes || values.sourceUrl || values.quantity !== '1')
}

export function linkedRequestData(workspaceSlug: string, values: LinkedRequestValues) {
  const name = values.name.trim()
  const notes = values.notes.trim()
  const sourceUrl = values.sourceUrl.trim()
  const quantity = Number(values.quantity)
  if (
    !name ||
    name.length > MAX_REQUEST_NAME_LENGTH ||
    !Number.isInteger(quantity) ||
    quantity < MIN_REQUEST_QUANTITY ||
    quantity > MAX_REQUEST_QUANTITY ||
    notes.length > MAX_REQUEST_NOTES_LENGTH ||
    !validSourceUrl(sourceUrl) ||
    !values.printType
  ) {
    return undefined
  }
  return {
    workspaceSlug,
    name,
    quantity,
    notes: notes || undefined,
    sourceUrl,
    requestedPrintType: values.printType,
  }
}

export function linkedRequestValidationError(values: LinkedRequestValues, t: Messages['requests']) {
  const name = values.name.trim()
  const quantity = Number(values.quantity)
  if (!name) return t.validation.enterTitle
  if (name.length > MAX_REQUEST_NAME_LENGTH) return t.validation.titleTooLong(MAX_REQUEST_NAME_LENGTH)
  if (!validSourceUrl(values.sourceUrl.trim())) return t.validation.invalidSourceLink
  if (!Number.isInteger(quantity) || quantity < MIN_REQUEST_QUANTITY || quantity > MAX_REQUEST_QUANTITY) {
    return t.validation.quantityRange(MIN_REQUEST_QUANTITY, MAX_REQUEST_QUANTITY)
  }
  if (!values.printType) return t.validation.choosePrintType
  if (values.notes.trim().length > MAX_REQUEST_NOTES_LENGTH) return t.validation.notesTooLong(MAX_REQUEST_NOTES_LENGTH)
  return undefined
}
