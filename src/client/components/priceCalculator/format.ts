import type { ElectricityPricePreset } from '../../../core/electricityPresets'
import { DEFAULT_LOCALE, type Locale, type Messages } from '../../../core/i18n'
import type { PriceCalculatorCurrency } from '../../../core/priceCalculator'

export function formatMoney(value: number, currency: PriceCalculatorCurrency, locale: Locale = DEFAULT_LOCALE) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value)
}

/**
 * A per-unit rate: amounts under one currency unit keep one more digit, so €0.149/mL does not round to €0.15, and
 * at least two significant digits, so a belt's €0.0048 per print hour does not read as €0.00.
 */
export function formatRate(value: number, currency: PriceCalculatorCurrency, locale: Locale = DEFAULT_LOCALE) {
  const digits = new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  const extra = value > 0 && value < 1 ? Math.max(1, Math.ceil(-Math.log10(value)) + 1 - digits) : 0
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: Math.min(digits + extra, 8) }).format(value)
}

export function currencySymbol(currency: PriceCalculatorCurrency, locale: Locale) {
  const parts = new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(0)
  return parts.find((part) => part.type === 'currency')?.value ?? currency
}

export function currencyLabel(currency: PriceCalculatorCurrency, locale: Locale) {
  return `${currency} · ${new Intl.DisplayNames(locale, { type: 'currency' }).of(currency)}`
}

export function formatNumber(value: number, locale: Locale, maximumFractionDigits = 2) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value)
}

export function formatEurosPerKwh(value: number, locale: Locale) {
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value)} €/kWh`
}

export function countryFlag(countryCode: string) {
  return countryCode
    .toUpperCase()
    .split('')
    .map((character) => String.fromCodePoint(127397 + character.charCodeAt(0)))
    .join('')
}

/** The catalog names countries in English, so other languages use the browser's region names. */
export function countryName(preset: ElectricityPricePreset, locale: Locale) {
  if (locale === DEFAULT_LOCALE) return preset.countryName
  return new Intl.DisplayNames(locale, { type: 'region' }).of(preset.countryCode) ?? preset.countryName
}

export function electricitySourceLabel(preset: ElectricityPricePreset, t: Messages['calculator']) {
  return preset.source.id === 'iea-end-use-prices' ? t.electricity.ieaSource(preset.period) : t.electricity.eurostatSource(preset.period)
}
