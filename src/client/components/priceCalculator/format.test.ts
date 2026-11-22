import { describe, expect, it } from 'vitest'
import catalog from '../../../../catalogs/electricity/catalog.generated.json'
import { getElectricityPricePreset } from '../../../core/electricityPresets'
import { countryName, currencyLabel, currencySymbol, formatMoney, formatRate } from './format'

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

describe('calculator rate format', () => {
  it('keeps a third digit on a rate under one', () => {
    expect(formatRate(0.1494, 'EUR')).toBe('€0.149')
  })

  it('keeps two significant digits on a sub-cent rate', () => {
    expect(formatRate(23.98 / 5_000, 'EUR')).toBe('€0.0048')
  })

  it('does not round a tiny rate to zero', () => {
    expect(formatRate(2.99 / 1_000, 'EUR')).toBe('€0.003')
  })

  it('keeps the currency digits on a rate of one or more', () => {
    expect(formatRate(1.234, 'EUR')).toBe('€1.23')
  })
})

describe('electricity country names', () => {
  const cyprus = getElectricityPricePreset(catalog.presets, 'CY')!

  it('keeps the catalog name in English', () => {
    expect(countryName(cyprus, 'en')).toBe('Cyprus')
  })

  it('uses the localized region name in other languages', () => {
    expect(countryName(cyprus, 'fr')).toBe('Chypre')
  })
})
