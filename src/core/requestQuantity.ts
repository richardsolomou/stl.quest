export const MIN_REQUEST_QUANTITY = 1
export const MAX_REQUEST_QUANTITY = 50

export function normalizeRequestQuantity(value: unknown, fallback = MIN_REQUEST_QUANTITY) {
  const quantity = Math.round(Number(value) || fallback)
  return Math.min(MAX_REQUEST_QUANTITY, Math.max(MIN_REQUEST_QUANTITY, quantity))
}

export function validRequestQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_REQUEST_QUANTITY && value <= MAX_REQUEST_QUANTITY
}
