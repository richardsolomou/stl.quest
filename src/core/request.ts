export const MIN_REQUEST_QUANTITY = 1
export const MAX_REQUEST_QUANTITY = 50
export const MAX_REQUEST_NAME_LENGTH = 120
export const MAX_REQUEST_NOTES_LENGTH = 2_000
export const MAX_REQUEST_SOURCE_URL_LENGTH = 500

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
