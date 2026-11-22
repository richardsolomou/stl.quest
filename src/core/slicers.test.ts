import { describe, expect, it } from 'vitest'
import { getSlicer, isSlicerFor, resolvedSlicer, slicersFor } from './slicers'

const filamentPrinter = { printType: 'filament' as const, slicer: 'bambu-studio' }

describe('slicers', () => {
  it('lists only the slicers for a print type', () => {
    expect(slicersFor('resin').every(({ printTypes }) => printTypes.includes('resin'))).toBe(true)
  })

  it('accepts a slicer for its own print type', () => {
    expect(isSlicerFor('orcaslicer', 'filament')).toBe(true)
  })

  it('rejects a slicer for the other print type', () => {
    expect(isSlicerFor('orcaslicer', 'resin')).toBe(false)
  })

  it('rejects an unknown slicer', () => {
    expect(isSlicerFor('unknown', 'filament')).toBe(false)
  })

  it('opens a file in OrcaSlicer by its encoded URL', () => {
    expect(getSlicer('orcaslicer')?.openUrl?.('https://print.example/api/slicer/a/b')).toBe(
      'orcaslicer://open?file=https%3A%2F%2Fprint.example%2Fapi%2Fslicer%2Fa%2Fb',
    )
  })

  it('has no open URL for a slicer without a working scheme', () => {
    expect(getSlicer('bambu-studio')?.openUrl).toBeUndefined()
  })
})

describe('resolved slicer', () => {
  it("uses the printer's slicer", () => {
    expect(resolvedSlicer(filamentPrinter)?.id).toBe('bambu-studio')
  })

  it("prefers the material's slicer", () => {
    expect(resolvedSlicer(filamentPrinter, { slicer: 'orcaslicer' })?.id).toBe('orcaslicer')
  })

  it('ignores a material slicer for another print type', () => {
    expect(resolvedSlicer(filamentPrinter, { slicer: 'lychee' })?.id).toBe('bambu-studio')
  })

  it('has none without a printer', () => {
    expect(resolvedSlicer(undefined, { slicer: 'orcaslicer' })).toBeUndefined()
  })

  it('has none when nothing chose one', () => {
    expect(resolvedSlicer({ printType: 'resin' })).toBeUndefined()
  })
})
