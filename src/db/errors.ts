/** Whether `error`, or any error in its `cause` chain, carries the driver error `code`. */
export function errorHasCode(error: unknown, code: string) {
  const seen = new Set<unknown>()
  let current = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    if ('code' in current && current.code === code) return true
    current = 'cause' in current ? current.cause : undefined
  }
  return false
}
