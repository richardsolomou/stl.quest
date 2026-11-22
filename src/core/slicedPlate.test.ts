import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import {
  filamentGrams,
  layeredPlateFile,
  slicedFileBomb,
  slicedPlateArchive,
  slicedPlateFile,
  slicedPlateGcode,
  slicedPlateSliceInfo,
} from '../../e2e/fixtures/slicedPlate'
import { readSlicedFile, SlicedFileError } from './slicedPlate'

const PLA = { type: 'PLA', color: '#6F5034', density: 1.24, diameter: 1.75 }
const PETG = { type: 'PETG', color: '#FFFFFF', density: 1.27, diameter: 1.75 }

function plate(fixture: Parameters<typeof slicedPlateFile>[0]) {
  return readSlicedFile(slicedPlateFile(fixture), 'plate.gcode.3mf')[0]
}

function gcodePlate(gcode: string, sliceInfo?: string) {
  return readSlicedFile(
    slicedPlateArchive({ 'Metadata/plate_1.gcode': gcode, ...(sliceInfo && { 'Metadata/slice_info.config': sliceInfo }) }),
    'plate.gcode.3mf',
  )[0]
}

const header = '; filament_density: 1.24,1.27\n; filament_diameter: 1.75,1.75\n'

describe('readSlicedFile', () => {
  it('weighs each object from its relative extrusion', () => {
    const read = plate({ objects: [{ id: '1', name: 'Hull.stl', extrusionMm: 1000 }] })
    expect(read.objects[0].grams[0]).toBeCloseTo(filamentGrams(1000, PLA), 6)
  })

  it('names objects from the slice info', () => {
    const read = plate({ objects: [{ id: '264', name: 'Chimera_Hull_Uncut_repaired.stl_A', extrusionMm: 10 }] })
    expect(read.objects.map(({ id, name }) => ({ id, name }))).toEqual([{ id: '264', name: 'Chimera_Hull_Uncut_repaired.stl_A' }])
  })

  it('decodes XML entities in object names', () => {
    const read = plate({ objects: [{ id: '1', name: 'Rock & "Roll".stl', extrusionMm: 10 }] })
    expect(read.objects[0].name).toBe('Rock & "Roll".stl')
  })

  it('lists objects in slice info order', () => {
    const read = plate({
      objects: [
        { id: '9', name: 'B.stl', extrusionMm: 10 },
        { id: '3', name: 'A.stl', extrusionMm: 10 },
      ],
    })
    expect(read.objects.map(({ id }) => id)).toEqual(['9', '3'])
  })

  it('leaves skipped objects out', () => {
    const read = plate({
      objects: [
        { id: '1', name: 'Kept.stl', extrusionMm: 10 },
        { id: '2', name: 'Skipped.stl', extrusionMm: 10, skipped: true },
      ],
    })
    expect(read.objects.map(({ id }) => id)).toEqual(['1'])
  })

  it('keeps extrusion outside every object as overhead', () => {
    const read = plate({ objects: [{ id: '1', name: 'A.stl', extrusionMm: 100 }], overheadMm: 200 })
    expect(read.overhead[0]).toBeCloseTo(filamentGrams(200, PLA), 6)
  })

  it('weighs absolute extrusion as the change since the last E, through G92 resets', () => {
    const read = gcodePlate(
      `${header}M82\nG92 E0\n; start printing object, unique label id: 1\nG1 X1 E5\nG1 X2 E12\n; stop printing object, unique label id: 1\nG92 E0\nG1 E3\n; start printing object, unique label id: 2\nG1 X1 E10\n; stop printing object, unique label id: 2\n`,
    )
    expect(read.objects.map(({ grams }) => grams[0] / filamentGrams(1, PLA))).toEqual([expect.closeTo(12, 6), expect.closeTo(7, 6)])
  })

  it('counts a retraction and its unretraction as no extrusion', () => {
    const read = gcodePlate(
      `${header}M83\n; start printing object, unique label id: 1\nG1 E10\nG1 E-0.8\nG0 X5\nG1 E0.8\n; stop printing object, unique label id: 1\n`,
    )
    expect(read.objects[0].grams[0]).toBeCloseTo(filamentGrams(10, PLA), 6)
  })

  it('weighs each filament slot at its own density', () => {
    const read = plate({ filaments: [PLA, PETG], objects: [{ id: '1', name: 'Two colour.stl', extrusionMm: [100, 200] }] })
    expect(read.objects[0].grams).toEqual([expect.closeTo(filamentGrams(100, PLA), 6), expect.closeTo(filamentGrams(200, PETG), 6)])
  })

  it('ignores tool numbers past the loaded filaments', () => {
    const read = gcodePlate(
      `${header}M83\nT1\nT65535\n; start printing object, unique label id: 1\nG1 E10\n; stop printing object, unique label id: 1\n`,
    )
    expect(read.objects[0].grams[1]).toBeCloseTo(filamentGrams(10, PETG), 6)
  })

  it('takes moves only from G0 to G3', () => {
    const read = gcodePlate(
      `${header}M83\n; start printing object, unique label id: 1\nG1 E10\nM620.10 A0 E5\nG10 E3\n; stop printing object, unique label id: 1\n`,
    )
    expect(read.objects[0].grams[0]).toBeCloseTo(filamentGrams(10, PLA), 6)
  })

  it('handles lines split across inflated chunks', () => {
    const body = Array.from({ length: 20_000 }, () => 'G1 X1.234 Y5.678 E0.05').join('\n')
    const read = gcodePlate(
      `${header}M83\n; start printing object, unique label id: 1\n${body}\n; stop printing object, unique label id: 1\n`,
    )
    expect(read.objects[0].grams[0]).toBeCloseTo(filamentGrams(1000, PLA), 6)
  })

  it('describes the filaments the plate uses from the slice info', () => {
    const read = plate({ filaments: [PLA, PETG], objects: [{ id: '1', name: 'A.stl', extrusionMm: [100, 0] }] })
    expect(read.filaments).toEqual([{ slot: 0, type: 'PLA', color: '#6F5034', density: 1.24, diameter: 1.75, slicerGrams: 0.3 }])
  })

  it('reads the slicer total and print time from the slice info', () => {
    const read = plate({ objects: [{ id: '1', name: 'A.stl', extrusionMm: 100 }], predictionSeconds: 13764, weight: 99.03 })
    expect({ slicerGrams: read.slicerGrams, minutes: read.minutes }).toEqual({ slicerGrams: 99.03, minutes: 229.4 })
  })

  it('numbers each plate from its G-code entry', () => {
    const gcode = slicedPlateGcode({ objects: [{ id: '1', name: 'A.stl', extrusionMm: 10 }] })
    const plates = readSlicedFile(slicedPlateArchive({ 'Metadata/plate_2.gcode': gcode, 'Metadata/plate_5.gcode': gcode }), 'all.gcode.3mf')
    expect(plates.map(({ index }) => index)).toEqual([2, 5])
  })

  it('accounts for the slicer total within a hundredth of a gram, supports and purge included', () => {
    const objects = [
      { id: '264', name: 'Hull.stl_A', extrusionMm: 26_712.4 },
      { id: '298', name: 'Hull.stl_B_B', extrusionMm: 2_042.3 },
      { id: '321', name: 'Hull.stl_B_A', extrusionMm: 2_002.7 },
      { id: '332', name: 'Turret.stl', extrusionMm: 1_458.4 },
      { id: '354', name: 'Hull.stl-Dowel-Connector-1', extrusionMm: 6.6 },
    ]
    const fixture = { objects, overheadMm: 41.2, filaments: [PLA] }
    const read = plate(fixture)
    const accounted = read.objects.reduce((sum, { grams }) => sum + grams[0], read.overhead[0])
    expect(Math.abs(accounted - Number(slicedPlateSliceInfo(fixture).match(/key="weight" value="([\d.]+)"/)![1]))).toBeLessThanOrEqual(0.01)
  })

  describe('plain G-code', () => {
    const gcode = `; HEADER_BLOCK_START\n; model printing time: 3h 44m 15s; total estimated time: 3h 49m 24s\n; total filament weight [g] : 99.03\n; HEADER_BLOCK_END\n${header}; filament_type = PLA;PETG\n; filament_colour = #6F5034;#FFFFFF\nM83\n; start printing object, unique label id: 7\nG1 E10\n; stop printing object, unique label id: 7\n`
    const read = () => readSlicedFile(strToU8(gcode), 'plate_1.gcode')[0]

    it('keeps objects by label without names', () => {
      expect(read().objects.map(({ id, name }) => ({ id, name }))).toEqual([{ id: '7', name: undefined }])
    })

    it('reads the slicer total from the header', () => {
      expect(read().slicerGrams).toBe(99.03)
    })

    it('reads the print time from the header', () => {
      expect(read().minutes).toBeCloseTo(229.4, 6)
    })

    it('describes the filaments it extruded from the config lines', () => {
      expect(read().filaments).toEqual([{ slot: 0, type: 'PLA', color: '#6F5034', density: 1.24, diameter: 1.75 }])
    })
  })

  it('rejects a file that is neither a zip nor G-code', () => {
    expect(() => readSlicedFile(new Uint8Array([1, 2, 3, 4]), 'plate.3mf')).toThrow(SlicedFileError)
  })

  it('rejects a truncated archive', () => {
    const file = slicedPlateFile({ objects: [{ id: '1', name: 'A.stl', extrusionMm: 10 }] })
    expect(() => readSlicedFile(file.subarray(0, file.length - 22), 'plate.gcode.3mf')).toThrow(SlicedFileError)
  })

  it('rejects a project that was never sliced', () => {
    expect(() => readSlicedFile(zipSync({ '3D/3dmodel.model': strToU8('<model/>') }), 'project.3mf')).toThrow(SlicedFileError)
  })

  it('rejects a small file whose G-code inflates past what it reads, quickly and within bounded memory', () => {
    const bomb = slicedFileBomb([{ name: 'Metadata/plate_1.gcode', text: 'G1 X1 E0.01\n'.repeat(87_382), repeats: 1024 }])
    const before = process.memoryUsage()
    const startedAt = performance.now()

    expect(() => readSlicedFile(bomb, 'plate.gcode.3mf')).toThrow(SlicedFileError)

    const after = process.memoryUsage()
    expect([
      performance.now() - startedAt < 1_000,
      after.heapUsed + after.arrayBuffers - before.heapUsed - before.arrayBuffers < 64 * 1024 * 1024,
    ]).toEqual([true, true])
  })

  it('reads a file built like the bombs below that stays within its limits', () => {
    const file = slicedFileBomb([{ name: 'Metadata/plate_1.gcode', text: `${header}M83\nG1 E1000\n` }])
    expect(readSlicedFile(file, 'plate.gcode.3mf')[0].overhead[0]).toBeCloseTo(filamentGrams(1000, PLA), 6)
  })

  it('stops inflating an entry once it passes what its header claimed', () => {
    const bomb = slicedFileBomb([{ name: 'Metadata/plate_1.gcode', text: 'G1 E1\n'.repeat(1 << 18), repeats: 64, declaredBytes: 1024 }])
    expect(() => readSlicedFile(bomb, 'plate.gcode.3mf')).toThrow(SlicedFileError)
  })

  it('rejects slice info too large to hold in memory', () => {
    const bomb = slicedFileBomb([
      { name: 'Metadata/plate_1.gcode', text: 'M83\nG1 E1\n' },
      { name: 'Metadata/slice_info.config', text: ' '.repeat(1 << 20), repeats: 64 },
    ])
    expect(() => readSlicedFile(bomb, 'plate.gcode.3mf')).toThrow(SlicedFileError)
  })

  it('rejects a G-code line too long to hold in memory', () => {
    expect(() => readSlicedFile(new TextEncoder().encode(';'.repeat(4 << 20)), 'plate.gcode')).toThrow(SlicedFileError)
  })

  it('rejects a G-code line too long to hold in memory that ends inside one inflated chunk', () => {
    const file = slicedFileBomb([{ name: 'Metadata/plate_1.gcode', text: `; ${'a'.repeat(4 << 20)}\nM83\nG1 E1\n` }])
    expect(() => readSlicedFile(file, 'plate.gcode.3mf')).toThrow('G-code line too long')
  })

  it('reads the most filament slots a slicer can declare', () => {
    const densities = Array.from({ length: 64 }, () => '1.24').join(',')
    const read = gcodePlate(`; filament_density: ${densities}\nM83\nT63\nG1 E10\n`)
    expect(read.overhead[63]).toBeCloseTo(filamentGrams(10, PLA), 6)
  })

  it('rejects a file declaring more filament slots than a slicer can', () => {
    const densities = Array.from({ length: 65 }, () => '1').join(',')
    expect(() => gcodePlate(`; filament_density: ${densities}\nM83\nG1 E1\n`)).toThrow('too many filament slots')
  })

  it('sizes each object to the filament slots it used, not the ones declared', () => {
    const read = gcodePlate(
      `${header}M83\n; start printing object, unique label id: 1\nG1 E10\n; stop printing object, unique label id: 1\n`,
    )
    expect(read.objects[0].grams).toHaveLength(1)
  })

  it('rejects a file labelling more objects than a plate can hold', () => {
    const objects = Array.from({ length: 4097 }, (_, id) => `; start printing object, unique label id: ${id}\nG1 E1`).join('\n')
    expect(() => gcodePlate(`M83\n${objects}\n`)).toThrow('too many objects')
  })

  it('rejects a tiny file declaring hundreds of thousands of slots, quickly and within bounded memory', () => {
    const densities = Array.from({ length: 400_000 }, () => '1').join(',')
    const objects = Array.from(
      { length: 300 },
      (_, id) => `; start printing object, unique label id: ${id}\nT399999\nG1 E1\n; stop printing object, unique label id: ${id}`,
    ).join('\n')
    const file = slicedFileBomb([{ name: 'Metadata/plate_1.gcode', text: `; filament_density = ${densities}\nM83\n${objects}\n` }])
    const before = process.memoryUsage()
    const startedAt = performance.now()

    expect(() => readSlicedFile(file, 'plate.gcode.3mf', 50)).toThrow(SlicedFileError)

    const after = process.memoryUsage()
    expect([
      file.length < 8_192,
      performance.now() - startedAt < 1_000,
      after.heapUsed + after.arrayBuffers - before.heapUsed - before.arrayBuffers < 64 * 1024 * 1024,
    ]).toEqual([true, true, true])
  })
})

describe('readSlicedFile up to a progress', () => {
  const objects = [
    { id: '1', name: 'Short.stl', layers: 20, mmPerLayer: 10 },
    { id: '2', name: 'Tall.stl', layers: 100, mmPerLayer: 10 },
  ]
  const stoppedAt = (progress?: number, markers = true) =>
    readSlicedFile(layeredPlateFile(objects, { markers }), 'plate.gcode.3mf', progress)[0]
  const printedMm = (progress: number) => stoppedAt(progress).printed!.objects.map((grams) => grams[0] / filamentGrams(1, PLA))

  it('charges an object shorter than where the print stopped in full', () => {
    expect(printedMm(50)[0]).toBeCloseTo(200, 6)
  })

  it('charges a taller object only up to where the print stopped', () => {
    expect(printedMm(50)[1]).toBeCloseTo(510, 6)
  })

  it('charges nothing past the first layer at 0%', () => {
    expect(printedMm(0)).toEqual([expect.closeTo(10, 6), expect.closeTo(10, 6)])
  })

  it('keeps every object whole at 100%', () => {
    expect(printedMm(100)).toEqual([expect.closeTo(200, 6), expect.closeTo(1000, 6)])
  })

  it('keeps the whole plate alongside what was printed', () => {
    expect(stoppedAt(50).objects[1].grams[0]).toBeCloseTo(filamentGrams(1000, PLA), 6)
  })

  it('reports nothing printed for G-code without progress markers', () => {
    expect(stoppedAt(50, false).printed).toBeUndefined()
  })

  it('reports nothing printed when no progress is asked for', () => {
    expect(stoppedAt().printed).toBeUndefined()
  })
})
