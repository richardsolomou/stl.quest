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

export function linkedRequestValidationError(values: LinkedRequestValues) {
  const name = values.name.trim()
  const quantity = Number(values.quantity)
  if (!name) return 'Enter a title.'
  if (name.length > MAX_REQUEST_NAME_LENGTH) return `Keep the title under ${MAX_REQUEST_NAME_LENGTH} characters.`
  if (!validSourceUrl(values.sourceUrl.trim())) return 'Enter a valid http(s) source link.'
  if (!Number.isInteger(quantity) || quantity < MIN_REQUEST_QUANTITY || quantity > MAX_REQUEST_QUANTITY) {
    return `Choose between ${MIN_REQUEST_QUANTITY} and ${MAX_REQUEST_QUANTITY} copies.`
  }
  if (!values.printType) return 'Choose resin or filament.'
  if (values.notes.trim().length > MAX_REQUEST_NOTES_LENGTH) return `Keep notes under ${MAX_REQUEST_NOTES_LENGTH} characters.`
  return undefined
}
