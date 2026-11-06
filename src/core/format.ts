import { DEFAULT_LOCALE, messagesFor, type Locale } from './i18n'

export function formatBytes(bytes: number, locale: Locale = DEFAULT_LOCALE) {
  const units = messagesFor(locale).common.byteUnits
  let value = bytes
  let unit = 0
  while (value >= 1_000 && unit < units.length - 1) {
    value /= 1_000
    unit++
  }
  // Rounding can reach the next unit, so a hair under 1 GB reads as 1.0 GB rather than 1000.0 MB.
  if (unit < units.length - 1 && Number(value.toFixed(unit ? 1 : 0)) >= 1_000) {
    value /= 1_000
    unit++
  }
  const digits = unit ? 1 : 0
  const number = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false })
  return `${number.format(value)} ${units[unit]}`
}
