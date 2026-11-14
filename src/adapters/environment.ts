const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on'])
const DISABLED_VALUES = new Set(['0', 'false', 'no', 'off'])

/** Whether the value is one `environmentFlag` recognises, so it overrides the fallback. */
export function environmentFlagSet(value: string | undefined) {
  const normalized = value?.trim().toLowerCase() ?? ''
  return ENABLED_VALUES.has(normalized) || DISABLED_VALUES.has(normalized)
}

export function environmentFlag(value: string | undefined, fallback = false) {
  if (value === undefined) return fallback
  const normalized = value.trim().toLowerCase()
  if (ENABLED_VALUES.has(normalized)) return true
  if (DISABLED_VALUES.has(normalized)) return false
  return fallback
}
