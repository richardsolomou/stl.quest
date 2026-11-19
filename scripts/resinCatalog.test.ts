import { describe, expect, it } from 'vitest'
import {
  formlabsResinPreset,
  mergeResinPresets,
  parseFormlabsMaterials,
  parseFormlabsSafetyDataSheets,
  parsePrusaSlaMaterials,
  parseSafetyDataSheetDensity,
  selectFormlabsResins,
  type FormlabsMaterial,
} from './resinCatalog'

describe('resin catalog synchronization', () => {
  it('deduplicates slicer profiles into material presets', () => {
    const contents = `
[sla_material:Siraya Tech Fast Grey @0.025]
material_type = Tough
material_vendor = Siraya Tech

[sla_material:Siraya Tech Fast Grey @0.05]
material_type = Tough
material_vendor = Siraya Tech
material_density = 1.12
`

    expect(parsePrusaSlaMaterials(contents, source())).toEqual([
      {
        id: 'resin-siraya-tech-fast-grey',
        brand: 'Siraya Tech',
        name: 'Fast Grey',
        type: 'Tough',
        densityGramsPerMl: 1.12,
        source: {
          id: 'prusaslicer',
          url: 'https://github.com/prusa3d/PrusaSlicer/blob/revision/resources/profiles/PrusaResearchSLA.ini',
        },
      },
    ])
  })

  it('ignores inherited templates and invalid densities', () => {
    const contents = `
[sla_material:*common*]
material_vendor = Generic

[sla_material:Example Resin @0.05]
material_vendor = Example
material_density = 0
`

    expect(parsePrusaSlaMaterials(contents, source())).toEqual([
      {
        id: 'resin-example-resin',
        brand: 'Example',
        name: 'Resin',
        source: {
          id: 'prusaslicer',
          url: 'https://github.com/prusa3d/PrusaSlicer/blob/revision/resources/profiles/PrusaResearchSLA.ini',
        },
      },
    ])
  })

  it('removes vendor prefixes separated by punctuation', () => {
    const contents = '[sla_material:3DM-ABS @0.05]\nmaterial_vendor = 3DM\nmaterial_type = Tough'

    expect(parsePrusaSlaMaterials(contents, source())[0]).toMatchObject({ id: 'resin-3dm-abs', brand: '3DM', name: 'ABS' })
  })

  it('lets curated manufacturer data supplement slicer profiles', () => {
    const generated = parsePrusaSlaMaterials(
      '[sla_material:Example Resin @0.05]\nmaterial_vendor = Example\nmaterial_density = 1.1',
      source(),
    )
    const curated = [{ ...generated[0], densityGramsPerMl: 1.2 }]

    expect(mergeResinPresets(generated, curated)).toEqual(curated)
  })
})

describe('Formlabs resin synchronization', () => {
  const materialsUrl = 'https://formlabs.com/global/products/materials/'

  it('lists current SLA resins with their pages, data sheet handles, and categories', () => {
    expect(
      parseFormlabsMaterials(materialsPage([listing('Black Resin V5', 'black-resin', 'blackv5', ['General Purpose'])]), materialsUrl),
    ).toEqual([
      {
        name: 'Black Resin V5',
        pageUrl: 'https://formlabs.com/global/products/black-resin/',
        dataSheetHandle: 'blackv5',
        categories: ['General Purpose'],
      },
    ])
  })

  it('finds the data sheet handle in any data sheet link', () => {
    const amber = listing('BioMed Amber Resin', 'biomed-amber-resin', undefined, ['Medical'])
    amber.enrichment.links = [
      { label: 'Datasheets', link: '/global/materials/data-sheets/' },
      { label: 'Request a Sample', link: '/global/materials/data-sheets/?product=biomedamber' },
    ]

    expect(parseFormlabsMaterials(materialsPage([amber]), materialsUrl)[0].dataSheetHandle).toBe('biomedamber')
  })

  it('skips SLS powders', () => {
    expect(
      parseFormlabsMaterials(materialsPage([listing('Nylon 12 Powder', 'nylon-12-powder', 'nylon12', [], 'SLS')]), materialsUrl),
    ).toEqual([])
  })

  it.each(['Cyan Pigment', 'Color Kit', 'Soft Tissue Starter Pack', 'Alumina 4N Resin'])('skips %s', (name) => {
    expect(parseFormlabsMaterials(materialsPage([listing(name, 'product', 'handle', [])]), materialsUrl)).toEqual([])
  })

  it('picks the US English safety data sheet for each product', () => {
    const page = dataSheetsPage([
      sheet('Black Resin V5 SDS (ENEU)', 'blackv5', 'https://media.formlabs.com/eu.pdf'),
      sheet('Black Resin V5 SDS (ENUS)', 'blackv5', 'https://media.formlabs.com/us.pdf'),
      sheet('Black Resin V5 TDS (EN-US)', 'blackv5', 'https://media.formlabs.com/tds.pdf', 'technical'),
    ])

    expect(parseFormlabsSafetyDataSheets(page)).toEqual([
      { handle: 'blackv5', label: 'Black Resin V5', url: 'https://media.formlabs.com/us.pdf' },
    ])
  })

  it('accepts an unqualified English safety data sheet when no US one exists', () => {
    const page = dataSheetsPage([sheet('Durable Resin SDS (EN)', 'durable', 'https://media.formlabs.com/en.pdf')])

    expect(parseFormlabsSafetyDataSheets(page)[0].url).toBe('https://media.formlabs.com/en.pdf')
  })

  it('matches a material by label when its data sheet handle is unknown', () => {
    const sheets = [{ handle: 'flexible50a', label: 'Flexible 50A Resin', url: 'https://media.formlabs.com/f50a.pdf' }]

    expect(selectFormlabsResins([material('Flexible 50A Resin', 'elastic50av2')], sheets).resins[0].sheetUrl).toBe(
      'https://media.formlabs.com/f50a.pdf',
    )
  })

  it('keeps one resin per safety data sheet under its shortest name', () => {
    const sheets = [{ handle: 'tough1500v2', label: 'Tough 1500 Resin V2', url: 'https://media.formlabs.com/t1500.pdf' }]
    const materials = [material('Tough 1500 Resin V2 (Form Studio 1)', 'tough1500v2'), material('Tough 1500 Resin V2', 'tough1500v2')]

    expect(selectFormlabsResins(materials, sheets).resins.map((resin) => resin.material.name)).toEqual(['Tough 1500 Resin V2'])
  })

  it('reports materials without a safety data sheet', () => {
    expect(selectFormlabsResins([material('Mystery Resin', 'mystery')], []).skipped).toEqual([
      { name: 'Mystery Resin', reason: 'no US English safety data sheet' },
    ])
  })

  it('reads a density stated in g/cm3', () => {
    expect(parseSafetyDataSheetDensity('      Density and/or relative density             1.09 g/cm3 @ 25°C')?.gramsPerMl).toBe(1.09)
  })

  it.each([
    ['gm/cm3', 'Density and/or relative density 1.11 gm/cm3', 1.11],
    ['an unspaced unit', 'Density and/or relative density 1.18g/cm3', 1.18],
    ['kg/L', 'Density and/or relative density 1.08 kg/L', 1.08],
  ])('reads a density stated in %s', (_unit, text, expected) => {
    expect(parseSafetyDataSheetDensity(text)?.gramsPerMl).toBe(expected)
  })

  it('reads a separate density row without mistaking vapor density for it', () => {
    const text =
      'Vapor density   Not determined or not available.\nDensity   1.07 g/cm3\nRelative density   Not determined or not available.'

    expect(parseSafetyDataSheetDensity(text)?.gramsPerMl).toBe(1.07)
  })

  it('cites the safety data sheet section for a stated density', () => {
    expect(parseSafetyDataSheetDensity('Density 1.07 g/cm3')?.note).toBe(
      "Stated as 1.07 g/cm³ in section 9 of the manufacturer's US safety data sheet.",
    )
  })

  it('uses the midpoint of a density range', () => {
    const text =
      'Relative density\n   No data available\nDensity\n   Value      1.25     -   1.5       g/cm³\n   Reference temperature 20 °C'

    expect(parseSafetyDataSheetDensity(text)).toEqual({
      gramsPerMl: 1.375,
      note: "Midpoint of the 1.25–1.5 g/cm³ range stated in section 9 of the manufacturer's US safety data sheet.",
    })
  })

  it('returns no density when the safety data sheet does not determine one', () => {
    const text =
      'Density and/or relative density   Not determined or not available.\nRelative vapor density   Not determined or not available.'

    expect(parseSafetyDataSheetDensity(text)).toBeUndefined()
  })

  it('ignores a unitless relative density', () => {
    expect(parseSafetyDataSheetDensity('Relative density 1.1')).toBeUndefined()
  })

  it('builds a Formlabs preset with its product page and safety data sheet', () => {
    const density = { gramsPerMl: 1.11, note: 'note' }

    expect(
      formlabsResinPreset(material('Black Resin V5', 'blackv5', ['General Purpose']), 'https://media.formlabs.com/us.pdf', density),
    ).toEqual({
      id: 'resin-formlabs-black-v5',
      brand: 'Formlabs',
      name: 'Black V5',
      type: 'Model',
      densityGramsPerMl: 1.11,
      densitySource: { url: 'https://media.formlabs.com/us.pdf', note: 'note' },
      source: { id: 'formlabs-materials', url: 'https://formlabs.com/global/products/black-v5/' },
    })
  })

  it('drops trademark symbols from names', () => {
    expect(formlabsPreset(material('BEGO™ VarseoSmile® TriniQ® Resin', 'bego', ['Dental'])).name).toBe('BEGO VarseoSmile TriniQ')
  })

  it.each([
    [['General Purpose', 'Dental'], 'Model'],
    [['Casting', 'Dental'], 'Casting'],
    [['Temperature Resistant', 'Elastomeric', 'Medical'], 'Flexible'],
    [['Impact Resistant', 'Medical'], 'Medical'],
    [['General Purpose', 'Impact Resistant'], 'Model'],
    [['Impact Resistant'], 'Tough'],
    [['High Stiffness', 'Temperature Resistant'], 'Engineering'],
    [['Specialty'], 'Engineering'],
  ])('maps the categories %j to the %s type', (categories, type) => {
    expect(formlabsPreset(material('Example Resin', 'example', categories)).type).toBe(type)
  })

  it('omits the type when Formlabs lists no category', () => {
    expect(formlabsPreset(material('Durable Resin', 'durable', []))).not.toHaveProperty('type')
  })
})

function formlabsPreset(value: FormlabsMaterial) {
  return formlabsResinPreset(value, 'https://media.formlabs.com/sds.pdf', { gramsPerMl: 1.1, note: 'note' })
}

function material(name: string, dataSheetHandle: string, categories: string[] = []): FormlabsMaterial {
  const slug = name
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-resin|-$/g, '')
  return { name, pageUrl: `https://formlabs.com/global/products/${slug}/`, dataSheetHandle, categories }
}

function listing(name: string, path: string, handle: string | undefined, categories: string[], technology = 'SLA') {
  const tag = (label: string) => ({ label, name: label.toLocaleLowerCase(), order: 0 })
  return {
    link: `/global/products/${path}/`,
    enrichment: {
      name,
      tags: {
        'print-technology': { tags: [tag(technology)], category: 'Print Technology' },
        categories: { tags: categories.map(tag), category: 'Categories' },
      },
      links: [{ label: 'Datasheets', link: `/global/materials/data-sheets/${handle ? `?product=${handle}` : ''}` }],
    },
  }
}

function materialsPage(products: unknown[]) {
  return nextDataPage([{ pluginType: 'V3ShopifyProductList', id: 1, props: JSON.stringify({ products }), parent: null }])
}

function sheet(displayName: string, handle: string, file: string, sheetType = 'safety') {
  return { display_name: displayName, products: [handle], language: 'en', file, sheet_type: sheetType }
}

function dataSheetsPage(pdfs: ReturnType<typeof sheet>[]) {
  const labels = [...new Set(pdfs.map((pdf) => pdf.products[0]))].map((handle) => ({
    handle,
    label: pdfs.find((pdf) => pdf.products[0] === handle)!.display_name.replace(/ (SDS|TDS) \(.*$/, ''),
  }))
  return nextDataPage([{ pluginType: 'Datasheets', id: 1, props: JSON.stringify({ products: labels, pdfs }), parent: null }])
}

function nextDataPage(plugins: unknown[]) {
  const data = { props: { pageProps: { getContentData: { title: { page: { placeholders: [{ plugins }] } } } } } }
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`
}

function source() {
  return {
    id: 'prusaslicer',
    webRepository: 'https://github.com/prusa3d/PrusaSlicer',
    revision: 'revision',
    catalogPath: 'resources/profiles/PrusaResearchSLA.ini',
  }
}
