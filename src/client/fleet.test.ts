import { describe, expect, it } from 'vitest'
import type { PrinterSummary } from '../core/types'
import { availablePrintTypes, fleetPrintTypes, printersForPrintType } from './fleet'

const resin: PrinterSummary = { id: 'resin-1', name: 'Resin 1', printType: 'resin' }
const filament: PrinterSummary = { id: 'filament-1', name: 'Filament 1', printType: 'filament' }

describe('fleet helpers', () => {
  it('identifies a homogeneous fleet', () => {
    expect(fleetPrintTypes([resin])).toEqual(['resin'])
    expect(availablePrintTypes([resin])).toEqual(['resin'])
  })

  it('lists every printer for a given print type', () => {
    const resin2 = { ...resin, id: 'resin-2', name: 'Resin 2' }
    const printers = [resin, resin2, filament]

    expect(printersForPrintType(printers, 'resin')).toEqual([resin, resin2])
    expect(availablePrintTypes(printers)).toEqual(['resin', 'filament'])
  })

  it('allows either print type before printers are configured', () => {
    expect(availablePrintTypes([])).toEqual(['resin', 'filament'])
  })
})
