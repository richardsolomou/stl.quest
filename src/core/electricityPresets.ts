export type ElectricityPricePreset = {
  countryCode: string
  countryName: string
  eurPerKwh: number
  period: string
  source: { id: string; url: string }
}

export function getElectricityPricePreset(presets: readonly ElectricityPricePreset[] | undefined, countryCode?: string) {
  return countryCode ? presets?.find((preset) => preset.countryCode === countryCode) : undefined
}
