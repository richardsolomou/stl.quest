import { strToU8, zipSync } from 'fflate'
import { constants, deflateRawSync } from 'node:zlib'

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

export type LayeredFixtureObject = { id: string; name: string; layers: number; mmPerLayer: number }

/**
 * A plate as Bambu Studio writes it layer by layer: each layer starts with its `M73 P` progress marker and Z height,
 * then prints every object still that tall, so a short object is done before a tall one's top layers.
 */
export function layeredPlateGcode(objects: LayeredFixtureObject[], { markers = true } = {}) {
  const layers = Math.max(...objects.map((object) => object.layers))
  const lines = ['; HEADER_BLOCK_START', '; BambuStudio 02.09.01.70', `; total layer number: ${layers}`, '; HEADER_BLOCK_END', 'M83', 'T0']
  if (markers) lines.push(`M73 P0 R${layers}`)
  for (let layer = 0; layer < layers; layer++) {
    lines.push('; CHANGE_LAYER', `; Z_HEIGHT: ${((layer + 1) * 0.2).toFixed(2)}`)
    if (markers) lines.push(`M73 P${Math.floor((layer * 100) / layers)} R${layers - layer}`, `M73 L${layer + 1}`)
    for (const object of objects.filter((candidate) => candidate.layers > layer))
      lines.push(
        `; start printing object, unique label id: ${object.id}`,
        `G1 X1 Y1 E${object.mmPerLayer}`,
        `; stop printing object, unique label id: ${object.id}`,
      )
  }
  if (markers) lines.push('M73 P100 R0')
  lines.push('M84')
  return lines.join('\n') + '\n'
}

export function layeredPlateFile(objects: LayeredFixtureObject[], options?: { markers?: boolean }) {
  return slicedPlateArchive({
    'Metadata/plate_1.gcode': layeredPlateGcode(objects, options),
    'Metadata/slice_info.config': slicedPlateSliceInfo({
      objects: objects.map(({ id, name, layers, mmPerLayer }) => ({ id, name, extrusionMm: layers * mmPerLayer })),
    }),
  })
}

export type BombEntry = { name: string; text: string; repeats?: number; declaredBytes?: number }

/**
 * A zip bomb shaped like a sliced file: each entry inflates to `repeats` copies of its `text`, built from one compressed
 * copy so it costs nothing to make. Its CRCs are zero, since a reader that refuses it never gets as far as checking
 * them; with `declaredBytes`, an entry's headers claim that size instead of the real one.
 */
export function slicedFileBomb(entries: BombEntry[]) {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const { name, text, repeats = 1, declaredBytes } of entries) {
    const unit = deflateRawSync(text, { finishFlush: constants.Z_FULL_FLUSH })
    const data = Buffer.concat([...Array.from({ length: repeats }, () => unit), Buffer.from([3, 0])])
    const fileName = Buffer.from(name)
    const inflated = declaredBytes ?? Buffer.byteLength(text) * repeats
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(inflated, 22)
    local.writeUInt16LE(fileName.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(inflated, 24)
    central.writeUInt16LE(fileName.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, fileName, data)
    centrals.push(central, fileName)
    offset += local.length + fileName.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...locals, directory, end]))
}
