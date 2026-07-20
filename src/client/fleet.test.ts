import { describe, expect, it } from 'vitest'
import type { PrinterSummary } from '../core/types'
import { availablePrintTypes, fleetPrintTypes, printersForPrintType } from './fleet'

const resin: PrinterSummary = { id: 'resin-1', name: 'Resin 1', printType: 'resin', enabled: true }
const filament: PrinterSummary = { id: 'filament-1', name: 'Filament 1', printType: 'filament', enabled: true }

describe('fleet helpers', () => {
  it('identifies a homogeneous fleet', () => {
    expect(fleetPrintTypes([resin])).toEqual(['resin'])
    expect(availablePrintTypes([resin])).toEqual(['resin'])
  })

  it('lists configured print types without exposing individual printers', () => {
    const printers = [resin, { ...resin, id: 'resin-2', name: 'Resin 2', enabled: false }, filament]

    expect(printersForPrintType(printers, 'resin')).toEqual([resin])
    expect(availablePrintTypes(printers)).toEqual(['resin', 'filament'])
  })

  it('allows either print type before printers are configured', () => {
    expect(availablePrintTypes([])).toEqual(['resin', 'filament'])
  })
})
