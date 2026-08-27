import catalog from '../../electricity-catalog/catalog.generated.json'

export type ElectricityPricePreset = (typeof catalog.presets)[number]

export const ELECTRICITY_PRICE_PRESETS = catalog.presets
export const ELECTRICITY_PRICE_SOURCES = catalog.sources

export function getElectricityPricePreset(countryCode?: string) {
  return countryCode ? ELECTRICITY_PRICE_PRESETS.find((preset) => preset.countryCode === countryCode) : undefined
}
