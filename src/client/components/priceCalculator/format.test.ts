import { describe, expect, it } from 'vitest'
import { currencyLabel, currencySymbol, formatMoney } from './format'

describe('calculator money format', () => {
  it('shows the workspace currency instead of euros', () => {
    expect(formatMoney(21.47, 'EUR')).toBe('€21.47')
    expect(formatMoney(21.47, 'CAD')).toBe('CA$21.47')
    expect(formatMoney(21.47, 'JPY')).toBe('¥21')
    expect(currencySymbol('GBP')).toBe('£')
    expect(currencySymbol('CHF')).toBe('CHF')
    expect(currencyLabel('GBP')).toBe('GBP · British Pound')
  })
})
