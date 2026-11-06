import type { ElectricityPricePreset } from '../../../core/electricityPresets'
import { printerPowerProfile, type EquipmentPreset } from '../../../core/equipmentPresets'
import { DEFAULT_LOCALE, type Locale, type Messages } from '../../../core/i18n'
import type { PriceCalculatorCurrency } from '../../../core/priceCalculator'

export function formatMoney(value: number, currency: PriceCalculatorCurrency, locale: Locale = DEFAULT_LOCALE) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value)
}

export function currencySymbol(currency: PriceCalculatorCurrency, locale: Locale) {
  const parts = new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(0)
  return parts.find((part) => part.type === 'currency')?.value ?? currency
}

export function currencyLabel(currency: PriceCalculatorCurrency, locale: Locale) {
  return `${currency} · ${new Intl.DisplayNames(locale, { type: 'currency' }).of(currency)}`
}

export function formatNumber(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)
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

export function formatPowerProfiles(preset: EquipmentPreset, t: Messages['calculator']) {
  return preset.powerProfiles
    .map((profile) => (profile.watts ? `${t.equipment.phaseNames[profile.phase]} ${profile.watts} W` : t.equipment.includedInPrinter))
    .join(' · ')
}

export function formatPrinterPower(printerPresetId: string, locale: Locale) {
  const profile = printerPowerProfile(printerPresetId)
  return profile ? `${formatNumber(profile.watts, locale)} W` : ''
}
