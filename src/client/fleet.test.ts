import { describe, expect, it } from 'vitest'
import type { PrinterSummary } from '../core/types'
import {
  automaticPrinterId,
  fleetPrintTypes,
  initialRequestTarget,
  printersForPrintType,
  requestTargetOptions,
  showRequestTarget,
} from './fleet'

const resin: PrinterSummary = { id: 'resin-1', name: 'Resin 1', printType: 'resin', enabled: true }
const filament: PrinterSummary = { id: 'filament-1', name: 'Filament 1', printType: 'filament', enabled: true }

describe('fleet helpers', () => {
  it('identifies a homogeneous fleet and its automatic printer', () => {
    expect(fleetPrintTypes([resin])).toEqual(['resin'])
    expect(automaticPrinterId([resin])).toBe('resin-1')
    expect(initialRequestTarget([resin])).toBe('printer:resin-1')
  })

  it('requires a printer choice only when a print type has multiple enabled printers', () => {
    const printers = [resin, { ...resin, id: 'resin-2', name: 'Resin 2', enabled: false }, filament]

    expect(printersForPrintType(printers, 'resin')).toEqual([resin])
    expect(automaticPrinterId(printers)).toBeUndefined()
    expect(initialRequestTarget(printers, { requestedPrintType: 'filament' })).toBe('type:filament')
  })

  it('keeps a disabled current assignment visible without offering it to new requests', () => {
    const disabled = { ...filament, enabled: false }
    const printers = [resin, disabled]

    expect(requestTargetOptions(printers).map(({ value }) => value)).not.toContain('printer:filament-1')
    expect(requestTargetOptions(printers, disabled.id)).toContainEqual({
      value: 'printer:filament-1',
      label: 'Filament 1 (disabled)',
    })
    expect(showRequestTarget(printers, disabled.id)).toBe(true)
  })
})
