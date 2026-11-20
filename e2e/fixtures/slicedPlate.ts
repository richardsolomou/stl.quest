import { strToU8, zipSync } from 'fflate'

export type SlicedFixtureFilament = { type: string; color: string; density: number; diameter?: number }
export type SlicedFixtureObject = {
  id: string
  name: string
  /** Filament length extruded for the object, per filament slot; a number is slot 0 alone. */
  extrusionMm: number | number[]
  skipped?: boolean
}
export type SlicedFixture = {
  objects: SlicedFixtureObject[]
  filaments?: SlicedFixtureFilament[]
  /** Filament length extruded on slot 0 outside every object, such as a purge line. */
  overheadMm?: number
  predictionSeconds?: number
  /** The slicer's plate total; defaults to what the extrusion weighs. */
  weight?: number
}

const PLA: SlicedFixtureFilament = { type: 'PLA', color: '#6F5034', density: 1.24, diameter: 1.75 }

export function filamentGrams(lengthMm: number, filament: SlicedFixtureFilament) {
  return (lengthMm * Math.PI * ((filament.diameter ?? 1.75) / 2) ** 2 * filament.density) / 1000
}

/**
 * A plate as Bambu Studio labels it: each object's extrusion split into two blocks with a tool change between slots,
 * relative extrusion, and any overhead printed before the first object.
 */
export function slicedPlateGcode(fixture: SlicedFixture) {
  const filaments = fixture.filaments ?? [PLA]
  const lines = [
    '; HEADER_BLOCK_START',
    '; BambuStudio 02.09.01.70',
    `; filament_density: ${filaments.map(({ density }) => density).join(',')}`,
    `; filament_diameter: ${filaments.map(({ diameter }) => diameter ?? 1.75).join(',')}`,
    '; HEADER_BLOCK_END',
    `; filament_type = ${filaments.map(({ type }) => type).join(';')}`,
    `; filament_colour = ${filaments.map(({ color }) => color).join(';')}`,
    'M83',
    'T0',
  ]
  if (fixture.overheadMm) lines.push('; FEATURE: Prime tower', `G1 X10 Y10 E${fixture.overheadMm}`)
  for (const half of [0, 1]) {
    for (const object of fixture.objects) {
      const lengths = typeof object.extrusionMm === 'number' ? [object.extrusionMm] : object.extrusionMm
      lines.push(`; start printing object, unique label id: ${object.id}`)
      lengths.forEach((length, slot) => {
        if (!length) return
        lines.push(`T${slot}`, `G1 X1 Y1 E${length / 2}`)
        if (half === 1) lines.push('G1 X2 Y2 E-0.8', 'G1 X2 Y2 E0.8')
      })
      lines.push(`; stop printing object, unique label id: ${object.id}`)
    }
  }
  lines.push('T65535', 'M84')
  return lines.join('\n') + '\n'
}

export function slicedPlateSliceInfo(fixture: SlicedFixture) {
  const filaments = fixture.filaments ?? [PLA]
  const used = filaments.map((filament, slot) =>
    fixture.objects.reduce(
      (sum, object) => {
        const lengths = typeof object.extrusionMm === 'number' ? [object.extrusionMm] : object.extrusionMm
        return sum + filamentGrams(lengths[slot] ?? 0, filament)
      },
      slot === 0 ? filamentGrams(fixture.overheadMm ?? 0, filament) : 0,
    ),
  )
  const weight = fixture.weight ?? used.reduce((sum, grams) => sum + grams, 0)
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<config>',
    '  <plate>',
    '    <metadata key="index" value="1"/>',
    `    <metadata key="prediction" value="${fixture.predictionSeconds ?? 3600}"/>`,
    `    <metadata key="weight" value="${weight.toFixed(2)}"/>`,
    ...fixture.objects.map(
      (object) =>
        `    <object identify_id="${object.id}" name="${escapeXml(object.name)}" skipped="${object.skipped ? 'true' : 'false'}" />`,
    ),
    ...filaments.flatMap((filament, slot) =>
      used[slot] > 0
        ? [`    <filament id="${slot + 1}" type="${filament.type}" color="${filament.color}" used_g="${used[slot].toFixed(2)}" />`]
        : [],
    ),
    '  </plate>',
    '</config>',
  ].join('\n')
}

/** A `.gcode.3mf` holding one sliced plate, as Bambu Studio and OrcaSlicer export it. */
export function slicedPlateFile(fixture: SlicedFixture) {
  return slicedPlateArchive({
    'Metadata/plate_1.gcode': slicedPlateGcode(fixture),
    'Metadata/slice_info.config': slicedPlateSliceInfo(fixture),
  })
}

export function slicedPlateArchive(files: Record<string, string>) {
  return zipSync({
    '3D/3dmodel.model': strToU8('<model/>'),
    ...Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])),
  })
}

function escapeXml(text: string) {
  return text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
