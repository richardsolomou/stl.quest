import { describe, expect, it } from 'vitest'
import { calculatorPrefill, calculatorSearch, validateCalculatorSearch } from './calculatorSearch'

const job = { materialAmount: 30.456, materialUnit: 'ml' as const, printHours: 4.5678, plates: 1, handsOnMinutes: 0 }

describe('calculator search', () => {
  it('links a request job with rounded totals', () => {
    expect(calculatorSearch('resin', job)).toEqual({ printType: 'resin', material: 30.46, unit: 'ml', hours: 4.57 })
  })

  it('prefills the job the link describes', () => {
    expect(calculatorPrefill(validateCalculatorSearch({ printType: 'resin', material: '30.46', unit: 'ml', hours: '4.57' }))).toEqual({
      printType: 'resin',
      job: { materialAmount: 30.46, materialUnit: 'ml', printHours: 4.57 },
    })
  })

  it('prefills nothing without a print type', () => {
    expect(calculatorPrefill(validateCalculatorSearch({ material: '30', unit: 'ml', hours: '4' }))).toBeUndefined()
  })

  it('ignores negative totals', () => {
    expect(validateCalculatorSearch({ printType: 'filament', material: '-5', unit: 'g', hours: 'x' })).toEqual({
      printType: 'filament',
      unit: 'g',
    })
  })

  it('weighs filament in grams whatever unit the link carries', () => {
    expect(
      calculatorPrefill(validateCalculatorSearch({ printType: 'filament', material: '12', unit: 'ml', hours: '1' }))?.job.materialUnit,
    ).toBe('g')
  })
})
