import { describe, expect, it } from 'vitest'
import {
  applyCatalogOverrides,
  definitionPathsFromTree,
  extractProductImageUrl,
  formlabsPresetId,
  mergePrinterPresets,
  normalizePrinterModel,
  parseFormlabsProductImages,
  parseFormlabsTechSpecs,
  openResinBuildVolume,
  parseBuildVolumeHtml,
  parseIni,
  printableAreaDimensions,
  type GeneratedPrinterPreset,
} from './printerCatalog'

describe('printer catalog synchronization', () => {
  it('parses PrusaSlicer INI values', () => {
    expect(parseIni('# comment\ndisplay_width = 153.36\nmax_print_height=165\n')).toEqual({
      display_width: '153.36',
      max_print_height: '165',
    })
  })

  it('calculates rectangular dimensions from an offset printable area', () => {
    expect(printableAreaDimensions(['-5x10', '215x10', '215x230', '-5x230'])).toEqual({ widthMm: 220, depthMm: 220 })
  })

  it('normalizes official storefront printer titles without dropping model details', () => {
    expect(normalizePrinterModel('Anycubic Photon Mono X 6K (Limited Edition)', 'Anycubic')).toBe('photon mono x 6k')
  })

  it('parses manufacturer build volumes from product specifications', () => {
    expect(parseBuildVolumeHtml('<h6>Build Volume:</h6><p>230×144 x 350 mm (9.1×5.7×13.8 in)</p>')).toEqual({
      widthMm: 230,
      depthMm: 144,
      heightMm: 350,
    })
  })

  it('extracts product images from manufacturer page metadata', () => {
    expect(
      extractProductImageUrl(
        '&quot;product_image&quot;:{&quot;image&quot;:&quot;/uploads/Products/Sonic-mini-8K.webp?v=1&quot;}',
        'https://phrozen3d.com/en/products/sonic-mini-8k',
      ),
    ).toBe('https://phrozen3d.com/uploads/Products/Sonic-mini-8K.webp?v=1')
  })

  it('decodes product image metadata exactly once', () => {
    expect(
      extractProductImageUrl(
        '<meta property="og:image" content="https://example.com/image&amp;#x2F;preview.webp">',
        'https://example.com/product',
      ),
    ).toBe('https://example.com/image&#x2F;preview.webp')
  })

  it('accepts serialized printable areas from Orca profiles', () => {
    expect(printableAreaDimensions('0x0,220x0,220x215,0x215')).toEqual({ widthMm: 220, depthMm: 215 })
  })

  it('applies exclusions and patches deterministically', () => {
    const presets = [preset('second', 'Zeta'), preset('first', 'Alpha')]
    expect(
      applyCatalogOverrides(presets, {
        brandAliases: {},
        excludeIds: ['second'],
        patches: { first: { model: 'Patched' } },
      }),
    ).toEqual([{ ...presets[1], model: 'Patched' }])
  })

  it('keeps primary catalog entries when supplemental sources overlap', () => {
    const primary = preset('shared', 'Primary')
    expect(mergePrinterPresets([primary], [preset('shared', 'Supplemental'), preset('new', 'New')])).toEqual([
      primary,
      preset('new', 'New'),
    ])
  })

  it('derives Open Resin build dimensions from display metadata', () => {
    expect(
      openResinBuildVolume({
        name: 'GK3',
        buildVolumeMm: { width: null, depth: null, height: 240 },
        pixelSize: { x: 14, y: 19 },
        display: { resolutionX: 15120, resolutionY: 6230 },
      }),
    ).toEqual({ widthMm: 211.68, depthMm: 118.37, heightMm: 240 })
  })

  it('discovers printer definitions without including other repository files', () => {
    expect(
      definitionPathsFromTree(
        [
          { path: 'printers/gk3-series.json', type: 'blob' },
          { path: 'printers/nested/gktwo-series.json', type: 'blob' },
          { path: 'printers/assets/gk3.png', type: 'blob' },
          { path: 'printers/assets/metadata.json', type: 'blob' },
          { path: 'pluginDefinition.ts', type: 'blob' },
        ],
        'printers',
      ),
    ).toEqual(['printers/gk3-series.json', 'printers/nested/gktwo-series.json'])
  })

  it('parses Formlabs build volumes from tech specs comparison columns', () => {
    expect(
      parseFormlabsTechSpecs(
        nextDataPage([
          { pluginType: 'TableColumn', id: 1, props: JSON.stringify({ title: 'Form 4' }), parent: null },
          { pluginType: 'TableData', id: 2, props: JSON.stringify({ label: 'Build Volume (W x D x H)' }), parent: { id: 1 } },
          {
            pluginType: 'Text',
            id: 3,
            props: JSON.stringify({ body: '<p>20.0 × 12.5 × 21.0 cm<br>7.9 × 4.9 × 8.3 in</p>' }),
            parent: { id: 2 },
          },
        ]),
      ),
    ).toEqual([{ model: 'Form 4', widthMm: 200, depthMm: 125, heightMm: 210 }])
  })

  it('ignores Formlabs comparison cells other than build volume', () => {
    expect(
      parseFormlabsTechSpecs(
        nextDataPage([
          { pluginType: 'TableColumn', id: 1, props: JSON.stringify({ title: 'Form 4' }), parent: null },
          { pluginType: 'TableData', id: 2, props: JSON.stringify({ label: 'Printer Dimensions (W x D x H)' }), parent: { id: 1 } },
          { pluginType: 'Text', id: 3, props: JSON.stringify({ body: '<p>34.2 x 31.5 x 50.2 cm</p>' }), parent: { id: 2 } },
        ]),
      ),
    ).toEqual([])
  })

  it('keeps Formlabs plus models distinct from their base models', () => {
    expect(formlabsPresetId('Formlabs', 'Form 3+')).not.toBe(formlabsPresetId('Formlabs', 'Form 3'))
  })

  it('reads Formlabs product images from the printer comparison', () => {
    expect(
      parseFormlabsProductImages(
        nextDataPage([
          {
            pluginType: 'V3Comparison',
            id: 1,
            props: JSON.stringify({
              items: [{ title: 'Form 4', link: '/global/products/form-4/', media: { src: 'https://formlabs-media.formlabs.com/f4.png' } }],
            }),
            parent: null,
          },
        ]),
      ),
    ).toEqual([{ model: 'Form 4', pagePath: '/global/products/form-4/', imageUrl: 'https://formlabs-media.formlabs.com/f4.png' }])
  })
})

function nextDataPage(plugins: unknown[]) {
  const data = { props: { pageProps: { getContentData: { title: { page: { placeholders: [{ plugins }] } } } } } }
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`
}

function preset(id: string, brand: string): GeneratedPrinterPreset {
  return {
    id,
    brand,
    model: 'Model',
    printType: 'filament',
    widthMm: 100,
    depthMm: 100,
    heightMm: 100,
    source: { id: 'source', url: 'https://example.com' },
  }
}
