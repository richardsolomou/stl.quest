import { describe, expect, it } from 'vitest'
import { applyFilamentPatches, parseSpoolmanFilaments } from './filamentCatalog'

const source = { id: 'spoolmandb', webRepository: 'https://github.com/Donkie/SpoolmanDB', revision: 'revision', catalogPath: 'filaments' }

function parse(filaments: Record<string, unknown>[]) {
  return parseSpoolmanFilaments([{ path: 'filaments/brand.json', contents: JSON.stringify({ manufacturer: 'Brand', filaments }) }], source)
}

const basic = { name: '{color_name}', material: 'PLA', density: 1.24, colors: [{ name: 'Jade White', hex: 'FFFFFF' }] }
const marble = {
  name: '{color_name}',
  material: 'PLA',
  density: 1.22,
  pattern: 'marble',
  colors: [{ name: 'White Marble', hex: 'F7F3F0' }],
}

describe('filament catalog synchronization', () => {
  it('folds spool sizes of one product into one preset', () => {
    expect(parse([basic, { ...basic, colors: [{ name: 'Black', hex: '000000' }] }]).map((preset) => preset.colors?.length)).toEqual([2])
  })

  it('keeps a product line that shares a name template apart by its pattern', () => {
    expect(parse([basic, marble]).map((preset) => preset.name)).toEqual(['Marble PLA', 'PLA'])
  })

  it('keeps the plain product’s ID when a variant is split off', () => {
    expect(parse([marble, basic]).map((preset) => preset.id)).toEqual(['filament-brand-marble-pla', 'filament-brand-pla'])
  })

  it('keeps a variant’s colours out of the plain product', () => {
    expect(
      parse([basic, marble])
        .find((preset) => preset.name === 'PLA')
        ?.colors?.map((colour) => colour.names.en),
    ).toEqual(['Jade White'])
  })

  it('names a translucent variant', () => {
    expect(
      parse([
        { ...basic, material: 'PETG' },
        { ...basic, material: 'PETG', translucent: true },
      ]).map((preset) => preset.name),
    ).toEqual(['PETG', 'Translucent PETG'])
  })

  it('names a gradient variant', () => {
    expect(parse([basic, { ...basic, multi_color_direction: 'longitudinal' }]).map((preset) => preset.name)).toEqual([
      'Gradient PLA',
      'PLA',
    ])
  })

  it('qualifies only by what differs within the product line', () => {
    const silk = { ...basic, name: 'Silk {color_name}', translucent: true }
    expect(parse([silk, { ...silk, multi_color_direction: 'coaxial' }]).map((preset) => preset.name)).toEqual([
      'Dual Color Silk PLA',
      'Silk PLA',
    ])
  })

  it('leaves a product alone when its line already names the variant', () => {
    expect(parse([{ ...basic, name: 'Translucent {color_name}', translucent: true }]).map((preset) => preset.name)).toEqual([
      'Translucent PLA',
    ])
  })

  it('renames a patched preset without changing its ID', () => {
    expect(applyFilamentPatches(parse([basic]), { 'filament-brand-pla': { name: 'PLA Basic' } })[0]).toMatchObject({
      id: 'filament-brand-pla',
      name: 'PLA Basic',
    })
  })

  it('rejects a patch for a preset the catalog lacks', () => {
    expect(() => applyFilamentPatches(parse([basic]), { 'filament-brand-petg': { name: 'PETG Basic' } })).toThrow('filament-brand-petg')
  })
})
