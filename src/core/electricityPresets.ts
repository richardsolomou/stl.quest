import catalog from '../../catalogs/electricity/catalog.generated.json'

export type ElectricityPricePreset = (typeof catalog.presets)[number]

export const ELECTRICITY_PRICE_PRESETS = catalog.presets
export const ELECTRICITY_PRICE_SOURCES = catalog.sources

export function getElectricityPricePreset(countryCode?: string) {
  return countryCode ? ELECTRICITY_PRICE_PRESETS.find((preset) => preset.countryCode === countryCode) : undefined
}
