import { describe, expect, it } from 'vitest'
import catalog from '../../catalogs/printers/catalog.generated.json'
import { CLOSEST_PRINTER_PRESET_LIMIT, filterPrinterPresets, PRINTER_PRESETS } from './printerPresets'

const CATALOGUE: {
  id: string
  brand: string
  printType: string
  source: { url: string }
  image?: { src: string; sourceId: string; sourceUrl: string }
}[] = catalog.presets

describe('printer presets', () => {
  it('keeps stable unique IDs', () => {
    expect(new Set(PRINTER_PRESETS.map((preset) => preset.id)).size).toBe(PRINTER_PRESETS.length)
  })

  it('provides positive build volumes', () => {
    expect(PRINTER_PRESETS.every((preset) => preset.widthMm > 0 && preset.depthMm > 0 && preset.heightMm > 0)).toBe(true)
  })

  it('shows local pictures', () => {
    expect(PRINTER_PRESETS.every((preset) => !preset.image || preset.image.startsWith('/printer-presets/'))).toBe(true)
  })

  it('records the provenance of every printer and picture in the full catalogue', () => {
    expect(
      CATALOGUE.every(
        (preset) => preset.source.url.startsWith('https://') && (!preset.image || preset.image.sourceUrl.startsWith('https://')),
      ),
    ).toBe(true)
  })

  it('searches by brand, model, and print type', () => {
    expect(filterPrinterPresets('mars 5 ultra').presets.map((preset) => preset.id)).toContain('resin-elegoo-mars-5-ultra')
    expect(filterPrinterPresets('Elegoo Mars 2').presets.map((preset) => preset.id)).toContain('resin-elegoo-mars-2')
    expect(filterPrinterPresets('HeyGears Reflex 2').presets.map((preset) => preset.id)).toContain('resin-heygears-reflex-2')
    expect(filterPrinterPresets('bambu').presets.length).toBeGreaterThan(2)
    expect(filterPrinterPresets('resin').presets.every((preset) => preset.printType === 'resin')).toBe(true)
  })

  it('returns every preset for an empty search', () => {
    expect(filterPrinterPresets('  ').presets).toBe(PRINTER_PRESETS)
  })

  it('reports full-word matches as exact', () => {
    expect(filterPrinterPresets('mars 5 ultra').closest).toBe(false)
  })

  it('matches compact typing that drops the spaces between words', () => {
    expect(filterPrinterPresets('saturn4').presets.map((preset) => preset.model)).toContain('Saturn 4')
  })

  it('matches compact typing that spans several words', () => {
    expect(filterPrinterPresets('m7pro').presets.map((preset) => preset.model)).toContain('Photon Mono M7 Pro')
  })

  it('treats compact matches as exact', () => {
    expect(filterPrinterPresets('mars4ultra').closest).toBe(false)
  })

  it('falls back to closest matches when no preset matches every word', () => {
    expect(filterPrinterPresets('Sonic Mighty 99K').closest).toBe(true)
  })

  it('ranks closest matches by how many words they match', () => {
    expect(filterPrinterPresets('Phrozen Transform 99K').presets[0]?.id).toBe('resin-phrozen-transform')
  })

  it('suggests sibling models when one word misses', () => {
    expect(filterPrinterPresets('Sonic Mighty 99K').presets.map((preset) => preset.model)).toEqual(
      expect.arrayContaining(['Sonic Mighty 8K', 'Sonic Mighty Revo']),
    )
  })

  it('caps the closest matches', () => {
    expect(filterPrinterPresets('resin zzqx').presets).toHaveLength(CLOSEST_PRINTER_PRESET_LIMIT)
  })

  it('returns no closest matches when no word matches', () => {
    expect(filterPrinterPresets('zzqx').presets).toEqual([])
  })

  it('does not flag an empty result as closest matches', () => {
    expect(filterPrinterPresets('zzqx').closest).toBe(false)
  })

  it('does not tolerate typos', () => {
    expect(filterPrinterPresets('satrun').presets).toEqual([])
  })

  it('searches only the given presets', () => {
    const filament = PRINTER_PRESETS.filter((preset) => preset.printType === 'filament')
    expect(filterPrinterPresets('elegoo', filament).presets.every((preset) => preset.printType === 'filament')).toBe(true)
  })

  it('includes the Bambu Lab range used by the calculator picker', () => {
    const bambuModels = PRINTER_PRESETS.filter((preset) => preset.brand === 'Bambu Lab').map((preset) => preset.model)
    expect(bambuModels.length).toBeGreaterThanOrEqual(14)
    expect(bambuModels).toEqual(expect.arrayContaining(['A1', 'A1 mini', 'P1P', 'P1S', 'X1 Carbon', 'X1E', 'H2D', 'H2S']))
  })

  it('includes PrusaSlicer thumbnails for Prusa resin printers', () => {
    expect(
      CATALOGUE.filter((preset) => preset.brand === 'Prusa' && preset.printType === 'resin').map((preset) => preset.image?.sourceId),
    ).toEqual(['prusaslicer', 'prusaslicer'])
  })

  it('includes the Phrozen Sonic Mighty 12K build volume from its official specifications', () => {
    const preset = PRINTER_PRESETS.find((candidate) => candidate.id === 'resin-phrozen-sonic-mighty-12k')
    expect(preset && [preset.widthMm, preset.depthMm, preset.heightMm]).toEqual([218, 123, 235])
  })

  it('includes official product images for current Phrozen printers', () => {
    expect(CATALOGUE.filter((preset) => preset.image?.sourceId === 'phrozen-product-pages').map((preset) => preset.id)).toEqual([
      'resin-phrozen-sonic-mega-8k-s',
      'resin-phrozen-sonic-mega-8k-v2',
      'resin-phrozen-sonic-mighty-8k',
      'resin-phrozen-sonic-mighty-revo',
      'resin-phrozen-sonic-mighty-revo-16k',
      'resin-phrozen-sonic-mighty-revo-16k-max',
      'resin-phrozen-sonic-mini-8k',
      'resin-phrozen-sonic-mini-8k-s',
    ])
  })
})
