import { describe, expect, it } from 'vitest'
import { printerCatalog } from './printerCatalog'

describe('printer catalog', () => {
  it('contains unique, usable printer definitions', () => {
    expect(new Set(printerCatalog.map((printer) => printer.id)).size).toBe(printerCatalog.length)
    expect(printerCatalog.every((printer) => printer.widthMm > 0 && printer.depthMm > 0 && printer.heightMm > 0)).toBe(true)
  })

  it('covers representative FDM and SLA printers', () => {
    expect(printerCatalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ technology: 'fdm', manufacturer: 'Bambu Lab', model: 'X1 Carbon' }),
        expect.objectContaining({ technology: 'fdm', model: expect.stringContaining('Ender-3') }),
        expect.objectContaining({ technology: 'sla', manufacturer: 'Elegoo', model: expect.stringContaining('Saturn 4') }),
      ]),
    )
  })

  it('normalizes every SLA build plate with the long edge as width', () => {
    expect(printerCatalog.filter((printer) => printer.technology === 'sla').every((printer) => printer.widthMm >= printer.depthMm)).toBe(
      true,
    )
  })

  it('normalizes the Mars 2 dimensions from its panel-oriented source profile', () => {
    expect(printerCatalog.find((printer) => printer.id === 'uvtools:elegoo-mars-2')).toEqual(
      expect.objectContaining({ widthMm: 130.56, depthMm: 82.62, heightMm: 150 }),
    )
  })
})
