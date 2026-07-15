import { describe, expect, it } from 'vitest'
import type { PrinterSummary } from '../core/types'
import { automaticPrinterId, fleetTechnologies, printersForTechnology } from './fleet'

const resin: PrinterSummary = { id: 'resin-1', name: 'Resin 1', technology: 'resin' }
const fdm: PrinterSummary = { id: 'fdm-1', name: 'FDM 1', technology: 'fdm' }

describe('fleet helpers', () => {
  it('identifies a homogeneous fleet and its automatic printer', () => {
    expect(fleetTechnologies([resin])).toEqual(['resin'])
    expect(automaticPrinterId([resin], 'resin')).toBe('resin-1')
  })

  it('requires a printer choice only when a technology has multiple printers', () => {
    const printers = [resin, { ...resin, id: 'resin-2', name: 'Resin 2' }, fdm]

    expect(printersForTechnology(printers, 'resin')).toHaveLength(2)
    expect(automaticPrinterId(printers, 'resin')).toBeUndefined()
    expect(automaticPrinterId(printers, 'fdm')).toBe('fdm-1')
  })
})
