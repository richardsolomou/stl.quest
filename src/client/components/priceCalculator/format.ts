import type { ElectricityPricePreset } from '../../../core/electricityPresets'
import { printerPowerProfile, type EquipmentPreset } from '../../../core/equipmentPresets'

export function formatEuros(value: number) {
  return new Intl.NumberFormat('en', { style: 'currency', currency: 'EUR' }).format(value)
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(value)
}

export function formatEurosPerKwh(value: number) {
  return `${new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value)} €/kWh`
}

export function countryFlag(countryCode: string) {
  return countryCode
    .toUpperCase()
    .split('')
    .map((character) => String.fromCodePoint(127397 + character.charCodeAt(0)))
    .join('')
}

export function electricitySourceLabel(preset: ElectricityPricePreset) {
  if (preset.source.id === 'iea-end-use-prices') {
    return `IEA residential average for ${preset.period}, converted with the ECB annual average exchange rate`
  }
  return `Eurostat household average for ${preset.period}`
}

export function formatPowerProfiles(preset: EquipmentPreset) {
  return preset.powerProfiles
    .map((profile) => (profile.watts ? `${profile.phase} ${profile.watts} W` : 'included in printer power'))
    .join(' · ')
}

export function formatPrinterPower(printerPresetId: string) {
  const profile = printerPowerProfile(printerPresetId)
  return profile ? `${formatNumber(profile.watts)} W` : ''
}
