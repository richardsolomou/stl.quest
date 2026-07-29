export const MIN_REQUEST_QUANTITY = 1
export const MAX_REQUEST_QUANTITY = 50
export const MAX_REQUEST_NAME_LENGTH = 120
export const MAX_REQUEST_NOTES_LENGTH = 2_000
export const MAX_REQUEST_SOURCE_URL_LENGTH = 500
export const MAX_REQUEST_PRINTER_ID_LENGTH = 100

export type RequestUpdateFields = {
  name?: string
  quantity?: number
  notes?: string
  sourceUrl?: string
  requestedPrintType?: PrintType | null
  printerId?: string | null
}

export function normalizeRequestQuantity(value: unknown, fallback = MIN_REQUEST_QUANTITY) {
  const quantity = Math.round(Number(value) || fallback)
  return Math.min(MAX_REQUEST_QUANTITY, Math.max(MIN_REQUEST_QUANTITY, quantity))
}

export function validRequestQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_REQUEST_QUANTITY && value <= MAX_REQUEST_QUANTITY
}

export function validSourceUrl(value: string) {
  if (value.length > MAX_REQUEST_SOURCE_URL_LENGTH) return false
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

export function validRequestUpdate(fields: unknown): fields is RequestUpdateFields {
  if (!fields || typeof fields !== 'object') return false
  const update = fields as Record<keyof RequestUpdateFields, unknown>
  return (
    (update.name === undefined ||
      (typeof update.name === 'string' && !!update.name.trim() && update.name.length <= MAX_REQUEST_NAME_LENGTH)) &&
    (update.notes === undefined || (typeof update.notes === 'string' && update.notes.length <= MAX_REQUEST_NOTES_LENGTH)) &&
    (update.sourceUrl === undefined ||
      (typeof update.sourceUrl === 'string' && (update.sourceUrl.trim() === '' || validSourceUrl(update.sourceUrl.trim())))) &&
    (update.requestedPrintType === undefined ||
      update.requestedPrintType === null ||
      update.requestedPrintType === 'resin' ||
      update.requestedPrintType === 'filament') &&
    (update.printerId === undefined ||
      update.printerId === null ||
      (typeof update.printerId === 'string' && update.printerId.length <= MAX_REQUEST_PRINTER_ID_LENGTH)) &&
    (update.quantity === undefined || validRequestQuantity(update.quantity))
  )
}
import type { PrintType } from './types'
