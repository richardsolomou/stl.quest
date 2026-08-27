import { describe, expect, it } from 'vitest'
import { mergeResinPresets, parsePrusaSlaMaterials } from './resinCatalog'

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

function source() {
  return {
    id: 'prusaslicer',
    webRepository: 'https://github.com/prusa3d/PrusaSlicer',
    revision: 'revision',
    catalogPath: 'resources/profiles/PrusaResearchSLA.ini',
  }
}
