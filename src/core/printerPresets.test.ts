import { describe, expect, it } from 'vitest'
import { filterPrinterPresets, PRINTER_PRESETS } from './printerPresets'

describe('printer presets', () => {
  it('keeps stable unique IDs', () => {
    expect(new Set(PRINTER_PRESETS.map((preset) => preset.id)).size).toBe(PRINTER_PRESETS.length)
  })

  it('provides positive build volumes and provenance', () => {
    expect(
      PRINTER_PRESETS.every(
        (preset) =>
          preset.widthMm > 0 &&
          preset.depthMm > 0 &&
          preset.heightMm > 0 &&
          preset.source.url.startsWith('https://') &&
          (!preset.image || (preset.image.src.startsWith('/printer-presets/') && preset.image.sourceUrl.startsWith('https://'))),
      ),
    ).toBe(true)
  })

  it('searches by brand, model, and print type', () => {
    expect(filterPrinterPresets('mars 5 ultra').map((preset) => preset.id)).toContain('resin-elegoo-mars-5-ultra')
    expect(filterPrinterPresets('Elegoo Mars 2').map((preset) => preset.id)).toContain('resin-elegoo-mars-2')
    expect(filterPrinterPresets('HeyGears Reflex 2').map((preset) => preset.id)).toContain('resin-heygears-reflex-2')
    expect(filterPrinterPresets('bambu').length).toBeGreaterThan(2)
    expect(filterPrinterPresets('resin').every((preset) => preset.printType === 'resin')).toBe(true)
  })

  it('includes PrusaSlicer thumbnails for Prusa resin printers', () => {
    expect(
      PRINTER_PRESETS.filter((preset) => preset.brand === 'Prusa' && preset.printType === 'resin').map((preset) => preset.image?.sourceId),
    ).toEqual(['prusaslicer', 'prusaslicer'])
  })

  it('includes official product images for current Phrozen printers', () => {
    expect(PRINTER_PRESETS.filter((preset) => preset.image?.sourceId === 'phrozen-product-pages').map((preset) => preset.id)).toEqual([
      'resin-phrozen-sonic-mighty-8k',
      'resin-phrozen-sonic-mighty-revo',
      'resin-phrozen-sonic-mini-8k',
      'resin-phrozen-sonic-mini-8k-s',
    ])
  })
})
