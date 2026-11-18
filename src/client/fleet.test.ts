import { describe, expect, it } from 'vitest'
import type { PrinterSummary } from '../core/types'
import { availablePrintTypes, fleetPrintTypes } from './fleet'

const resin: PrinterSummary = { id: 'resin-1', name: 'Resin 1', printType: 'resin' }
const filament: PrinterSummary = { id: 'filament-1', name: 'Filament 1', printType: 'filament' }

describe('fleet helpers', () => {
  it('identifies a homogeneous fleet', () => {
    expect(fleetPrintTypes([resin])).toEqual(['resin'])
    expect(availablePrintTypes([resin])).toEqual(['resin'])
  })

  it('offers every print type in a mixed fleet', () => {
    expect(availablePrintTypes([resin, filament])).toEqual(['resin', 'filament'])
  })

  it('allows either print type before printers are configured', () => {
    expect(availablePrintTypes([])).toEqual(['resin', 'filament'])
  })
})
