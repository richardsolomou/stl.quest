import { describe, expect, it } from 'vitest'
import { applyColourCodes, applyFilamentPatches, parseSpoolmanFilaments, type GeneratedFilamentPreset } from './filamentCatalog'

const source = { id: 'spoolmandb', webRepository: 'https://github.com/Donkie/SpoolmanDB', revision: 'revision', catalogPath: 'filaments' }

function read(filaments: Record<string, unknown>[]) {
  return parseSpoolmanFilaments([{ path: 'filaments/brand.json', contents: JSON.stringify({ manufacturer: 'Brand', filaments }) }], source)
}

function parse(filaments: Record<string, unknown>[]) {
  return read(filaments).presets
}

const basic = { name: '{color_name}', material: 'PLA', density: 1.24, colors: [{ name: 'Jade White', hex: 'FFFFFF' }] }
const marble = {
  name: '{color_name}',
  material: 'PLA',
  density: 1.22,
  pattern: 'marble',
  colors: [
    { name: 'White Marble', hex: 'F7F3F0' },
    { name: 'Red Granite', hex: 'AD4E38' },
  ],
}
// A variant block with more than one colour, since a single colour flagged differently is that colour, not a product.
const range = [
  { name: 'Clear', hex: 'EEEEEE' },
  { name: 'Teal', hex: '008080' },
]

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
        { ...basic, material: 'PETG', translucent: true, colors: range },
      ]).map((preset) => preset.name),
    ).toEqual(['PETG', 'Translucent PETG'])
  })

  it('keeps a single colour flagged differently in its product', () => {
    expect(
      parse([
        { ...basic, name: 'Basic {color_name}' },
        { ...basic, name: 'Basic {color_name}', translucent: true, colors: [{ name: 'Natural', hex: 'F5F5DC' }] },
      ]).map((preset) => [preset.name, preset.colors?.map((colour) => colour.names.en)]),
    ).toEqual([['Basic PLA', ['Jade White', 'Natural']]])
  })

  it('names a gradient variant', () => {
    expect(parse([basic, { ...basic, multi_color_direction: 'longitudinal', colors: range }]).map((preset) => preset.name)).toEqual([
      'Gradient PLA',
      'PLA',
    ])
  })

  it('qualifies only by what differs within the product line', () => {
    const silk = { ...basic, name: 'Silk {color_name}', translucent: true, colors: range }
    expect(parse([silk, { ...silk, multi_color_direction: 'coaxial', colors: range }]).map((preset) => preset.name)).toEqual([
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

describe('SpoolmanDB IDs for matching Spoolman filaments', () => {
  it('records each colour under the SpoolmanDB ID its entries share', () => {
    expect(read([basic, marble]).spoolman.colours['brand_pla_whitemarble']).toEqual(['filament-brand-marble-pla', 'White Marble'])
  })

  it('finds a product line through the colour name its template fills in', () => {
    const matte = { name: 'Matte {color_name}', material: 'PLA', colors: [{ name: 'Charcoal', hex: '000000' }] }

    expect(read([matte]).spoolman.colours['brand_pla_mattecharcoal']).toEqual(['filament-brand-matte-pla', 'Charcoal'])
  })

  it('leaves out an ID two catalogue colours share', () => {
    // "Silk {color_name}" in Blue and a product named "Silk Blue" both fill in to "Silk Blue".
    const silk = { name: 'Silk {color_name}', material: 'PLA', colors: [{ name: 'Blue', hex: '0000FF' }] }
    const silkBlue = { name: 'Silk Blue', material: 'PLA', colors: [{ name: 'Silk Blue', hex: '0000FF' }] }

    expect(read([silk, silkBlue]).spoolman.colours['brand_pla_silkblue']).toBeUndefined()
  })

  it('keeps each product’s brand, material, and name', () => {
    expect(read([basic]).spoolman.presets['filament-brand-pla']).toEqual(['Brand', 'PLA', 'PLA'])
  })
})

describe('manufacturer colour codes', () => {
  const preset = (name: string, colours: [string, string][], brand = 'Bambu Lab'): GeneratedFilamentPreset => ({
    id: `filament-${name}`,
    brand,
    name,
    colors: colours.map(([en, hex]) => ({ hex, names: { en } })),
    source: { id: 'spoolmandb', url: 'https://example.com' },
  })
  const entry = (product: string, code: string, en: string, hex: string) => ({
    fila_type: product,
    fila_color_code: code,
    fila_color_name: { en, de: `${en} (de)` },
    fila_color: [`${hex}FF`],
  })
  const codes = (presets: GeneratedFilamentPreset[], ...entries: ReturnType<typeof entry>[]) =>
    applyColourCodes(presets, 'Bambu Lab', JSON.stringify({ data: entries })).flatMap((found) =>
      (found.colors ?? []).map((colour) => [found.name, colour.names.en, colour.code]),
    )

  it('records the code of a colour whose product, name, and hex agree', () => {
    expect(codes([preset('PLA Basic', [['Gray', '#8E9089']])], entry('PLA Basic', '10103', 'Gray', '#8E9089'))).toEqual([
      ['PLA Basic', 'Gray', '10103'],
    ])
  })

  it('finds a product whose words come in another order', () => {
    expect(codes([preset('Matte PLA', [['Charcoal', '#000000']])], entry('PLA Matte', '11101', 'Charcoal', '#000000'))).toEqual([
      ['Matte PLA', 'Charcoal', '11101'],
    ])
  })

  it('leaves a colour without a code when its hex differs', () => {
    expect(codes([preset('PLA Basic', [['Gray', '#8E9089']])], entry('PLA Basic', '10103', 'Gray', '#808080'))).toEqual([
      ['PLA Basic', 'Gray', undefined],
    ])
  })

  it('leaves a colour without a code when two codes claim it', () => {
    expect(
      codes(
        [preset('Silk PLA', [['White', '#FFFFFF']])],
        entry('PLA Silk', '13105', 'White', '#FFFFFF'),
        entry('PLA Silk+', '13110', 'White', '#FFFFFF'),
      ),
    ).toEqual([['Silk PLA', 'White', undefined]])
  })

  it('codes only the manufacturer’s own products', () => {
    expect(codes([preset('PLA Basic', [['Gray', '#8E9089']], 'Other')], entry('PLA Basic', '10103', 'Gray', '#8E9089'))).toEqual([
      ['PLA Basic', 'Gray', undefined],
    ])
  })
})
