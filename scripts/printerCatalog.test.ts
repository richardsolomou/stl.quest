import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
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
  writePresetImage,
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

  it('parses build volumes from product structured data', () => {
    expect(parseBuildVolumeHtml('{"@type": "PropertyValue", "name": "Printing Volume", "value": "W 218 × D 123 × H 235 mm"}')).toEqual({
      widthMm: 218,
      depthMm: 123,
      heightMm: 235,
    })
  })

  it('keeps fractional build volume dimensions', () => {
    expect(parseBuildVolumeHtml('"name":"Printing Volume","value":"W 302.4 x D 161.98 x H 300 mm"')).toEqual({
      widthMm: 302.4,
      depthMm: 161.98,
      heightMm: 300,
    })
  })

  it('converts centimetre build volumes from support articles', () => {
    expect(parseBuildVolumeHtml('<p><strong>Printing volume</strong>: L21.8 x W12.3 x H23.5 cm</p>')).toEqual({
      widthMm: 218,
      depthMm: 123,
      heightMm: 235,
    })
  })

  it('ignores pages without a build volume', () => {
    expect(parseBuildVolumeHtml('<p>Build volume matters for large prints.</p><p>Printer size: 33 x 33 x 51 cm</p>')).toBeUndefined()
  })

  it('prefers the structured data product image over the social preview', () => {
    expect(
      extractProductImageUrl(
        '<meta property="og:image" content="https://example.com/banner.jpg"><script type="application/ld+json">{"@type":"Product","name":"Revo","image":["https://example.com/printer.png","https://example.com/banner.jpg"],"brand":{}}</script>',
        'https://example.com/product',
      ),
    ).toBe('https://example.com/printer.png')
  })

  it('reads a single structured data product image', () => {
    expect(
      extractProductImageUrl(
        '{"@type":"Product","name":"Revo 16K","image":"https://example.com/printer.webp"}',
        'https://example.com/product',
      ),
    ).toBe('https://example.com/printer.webp')
  })

  it('ignores images outside the structured data product', () => {
    expect(
      extractProductImageUrl(
        '<meta property="og:image" content="https://example.com/printer.jpg">{"@type":"Product","offers":{"image":"https://example.com/offer.png"}}',
        'https://example.com/product',
      ),
    ).toBe('https://example.com/printer.jpg')
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

  it('writes preset images as WebP', async () => {
    expect((await sharp(await presetImage(1000, 500)).metadata()).format).toBe('webp')
  })

  it('shrinks large preset images to fit the preset image size', async () => {
    expect((await sharp(await presetImage(1000, 500)).metadata()).width).toBe(256)
  })

  it('never enlarges small preset images', async () => {
    expect((await sharp(await presetImage(100, 80)).metadata()).width).toBe(100)
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

async function presetImage(width: number, height: number) {
  const output = path.join(mkdtempSync(path.join(os.tmpdir(), 'preset-image-')), 'image.webp')
  const input = await sharp({ create: { width, height, channels: 4, background: '#ff6600' } })
    .png()
    .toBuffer()
  await writePresetImage(input, output)
  return output
}

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
