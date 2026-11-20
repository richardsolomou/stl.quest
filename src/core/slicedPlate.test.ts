import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { filamentGrams, slicedPlateArchive, slicedPlateFile, slicedPlateGcode, slicedPlateSliceInfo } from '../../e2e/fixtures/slicedPlate'
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
})
