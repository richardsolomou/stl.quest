import { describe, expect, it } from 'vitest'
import { ELECTRICITY_PRICE_PRESETS, getElectricityPricePreset } from './electricityPresets'

describe('electricity price presets', () => {
  it('keeps unique country codes with positive prices', () => {
    expect(new Set(ELECTRICITY_PRICE_PRESETS.map((preset) => preset.countryCode)).size).toBe(ELECTRICITY_PRICE_PRESETS.length)
    expect(ELECTRICITY_PRICE_PRESETS.every((preset) => preset.eurPerKwh > 0)).toBe(true)
  })

  it('includes the latest Cyprus household average', () => {
    expect(getElectricityPricePreset('CY')).toMatchObject({ countryName: 'Cyprus', eurPerKwh: 0.2774, period: '2025-S2' })
  })

  it('includes non-European household averages', () => {
    expect(getElectricityPricePreset('US')).toMatchObject({ countryName: 'United States', period: '2025' })
  })
})
