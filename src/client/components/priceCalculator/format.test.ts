import { describe, expect, it } from 'vitest'
import { getElectricityPricePreset } from '../../../core/electricityPresets'
import { countryName, currencyLabel, currencySymbol, formatMoney } from './format'

describe('calculator money format', () => {
  it('shows the workspace currency instead of euros', () => {
    expect(formatMoney(21.47, 'EUR')).toBe('€21.47')
    expect(formatMoney(21.47, 'CAD')).toBe('CA$21.47')
    expect(formatMoney(21.47, 'JPY')).toBe('¥21')
    expect(currencySymbol('GBP', 'en')).toBe('£')
    expect(currencySymbol('CHF', 'en')).toBe('CHF')
    expect(currencyLabel('GBP', 'en')).toBe('GBP · British Pound')
  })

  it('formats money in the active language', () => {
    expect(formatMoney(21.47, 'EUR', 'fr')).toBe('21,47 €')
  })
})

describe('electricity country names', () => {
  const cyprus = getElectricityPricePreset('CY')!

  it('keeps the catalog name in English', () => {
    expect(countryName(cyprus, 'en')).toBe('Cyprus')
  })

  it('uses the localized region name in other languages', () => {
    expect(countryName(cyprus, 'fr')).toBe('Chypre')
  })
})
