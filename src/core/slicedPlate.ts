import { Unzip, UnzipInflate, unzipSync } from 'fflate'

/**
 * What a sliced plate used, read from the slicer's own export: each labelled object's filament weighed from the
 * extrusion inside its `start printing object` blocks, and everything extruded outside them (purge, prime tower,
 * flushing) kept apart as overhead. Bambu Studio and OrcaSlicer label objects this way in `.gcode.3mf` and plain G-code.
 */

export type SlicedFilament = {
  /** 0-based, the `T` index the G-code selects it by. */
  slot: number
  type?: string
  /** `#RRGGBB`. */
  color?: string
  /** g/cm³. */
  density: number
  /** mm. */
  diameter: number
  slicerGrams?: number
}

export type SlicedObject = {
  /** The slicer's label ID. */
  id: string
  /** Absent in plain G-code, which carries only label IDs. */
  name?: string
  /** Per filament slot. */
  grams: number[]
}

export type SlicedPlate = {
  /** The plate's number in the file, 1-based. */
  index: number
  objects: SlicedObject[]
  /** Grams per slot extruded outside every object; the final retraction can leave it a hair below zero. */
  overhead: number[]
  /** Only the filaments the plate uses. */
  filaments: SlicedFilament[]
  /** The slicer's own plate total. */
  slicerGrams?: number
  /** The slicer's print time prediction. */
  minutes?: number
}

export class SlicedFileError extends Error {}

const MAX_ENTRIES = 4096
const PLATE_GCODE = /^Metadata\/plate_(\d+)\.gcode$/
const SLICE_INFO = 'Metadata/slice_info.config'
const CHUNK = 1 << 20
/** Nominal PLA, for G-code that never states its filament. */
const DEFAULT_DENSITY = 1.24
const DEFAULT_DIAMETER = 1.75
/** Bambu firmware takes T255, T65279, and T65535 as commands rather than tools, so only a loaded slot switches. */
const MAX_SLOTS_UNSTATED = 64

/** Reads a Bambu Studio or OrcaSlicer `.gcode.3mf` (every plate G-code it holds) or a plain `.gcode`. */
export function readSlicedFile(bytes: Uint8Array, fileName: string): SlicedPlate[] {
  if (isZip(bytes)) return readArchive(bytes)
  if (!/\.g(code)?$/i.test(fileName)) throw new SlicedFileError('not a sliced file')
  const reader = new GcodeReader()
  const decoder = new TextDecoder()
  for (let offset = 0; offset < bytes.length; offset += CHUNK)
    reader.push(decoder.decode(bytes.subarray(offset, offset + CHUNK), { stream: true }))
  reader.push(decoder.decode())
  return [reader.plate(1)]
}

function isZip(bytes: Uint8Array) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4
}

function readArchive(bytes: Uint8Array) {
  let directoryEntries = 0
  let entries = 0
  const readers = new Map<number, GcodeReader>()
  let sliceInfo: string | undefined
  try {
    // Streaming inflation reads local members only, so the central directory is checked separately for a whole archive.
    unzipSync(bytes, {
      filter: () => {
        if (++directoryEntries > MAX_ENTRIES) throw new SlicedFileError('too many archive entries')
        return false
      },
    })
    const archive = new Unzip((entry) => {
      if (++entries > MAX_ENTRIES) throw new SlicedFileError('too many archive entries')
      const plate = PLATE_GCODE.exec(entry.name)
      if (!plate && entry.name !== SLICE_INFO) return
      const decoder = new TextDecoder()
      const reader = plate ? new GcodeReader() : undefined
      if (plate) readers.set(Number(plate[1]), reader!)
      let text = ''
      entry.ondata = (error, chunk, final) => {
        if (error) throw error
        const decoded = decoder.decode(chunk, { stream: !final })
        if (reader) reader.push(decoded)
        else text += decoded
        if (final && !reader) sliceInfo = text
      }
      entry.start()
    })
    archive.register(UnzipInflate)
    for (let offset = 0; offset < bytes.length; offset += CHUNK)
      archive.push(bytes.subarray(offset, offset + CHUNK), offset + CHUNK >= bytes.length)
  } catch (error) {
    if (error instanceof SlicedFileError) throw error
    throw new SlicedFileError('unreadable archive', { cause: error })
  }
  if (entries !== directoryEntries) throw new SlicedFileError('incomplete archive')
  if (readers.size === 0) throw new SlicedFileError('no sliced plate')
  const info = sliceInfo === undefined ? new Map<number, PlateInfo>() : plateInfo(sliceInfo)
  return [...readers].sort(([left], [right]) => left - right).map(([index, reader]) => reader.plate(index, info.get(index)))
}

type PlateInfo = {
  objects: { id: string; name: string; skipped: boolean }[]
  filaments: { slot: number; type?: string; color?: string; usedGrams?: number }[]
  weight?: number
  predictionSeconds?: number
}

function plateInfo(xml: string) {
  const plates = new Map<number, PlateInfo>()
  for (const [, body] of xml.matchAll(/<plate>([\s\S]*?)<\/plate>/g)) {
    const metadata = new Map(
      [...body.matchAll(/<metadata\s([^>]*?)\/?>/g)]
        .map(([, attributes]) => attributesOf(attributes))
        .map((entry) => [entry.key, entry.value]),
    )
    const index = Number(metadata.get('index'))
    if (!Number.isInteger(index)) continue
    plates.set(index, {
      objects: [...body.matchAll(/<object\s([^>]*?)\/?>/g)].map(([, attributes]) => {
        const object = attributesOf(attributes)
        return { id: object.identify_id ?? '', name: object.name ?? '', skipped: object.skipped === 'true' }
      }),
      filaments: [...body.matchAll(/<filament\s([^>]*?)\/?>/g)].map(([, attributes]) => {
        const filament = attributesOf(attributes)
        return {
          slot: Number(filament.id) - 1,
          type: filament.type || undefined,
          color: filament.color || undefined,
          usedGrams: finite(filament.used_g),
        }
      }),
      weight: finite(metadata.get('weight')),
      predictionSeconds: finite(metadata.get('prediction')),
    })
  }
  return plates
}

function attributesOf(text: string): Record<string, string | undefined> {
  return Object.fromEntries([...text.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, name, value]) => [name, decodeXml(value)]))
}

function decodeXml(text: string) {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (code[0] !== '#') return named[code.toLowerCase()] ?? entity
    const point = code[1] === 'x' || code[1] === 'X' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1))
    return Number.isInteger(point) && point <= 0x10ffff ? String.fromCodePoint(point) : entity
  })
}

function finite(value: string | undefined) {
  const number = Number(value)
  return value !== undefined && value !== '' && Number.isFinite(number) ? number : undefined
}

/** Sums one plate's extrusion in millimetres of filament per object and slot as its lines arrive, a chunk at a time. */
class GcodeReader {
  private rest = ''
  private relative = false
  private lastE = 0
  private slot = 0
  private label: string | undefined
  private readonly objects = new Map<string, number[]>()
  private readonly overhead: number[] = []
  private densities: number[] = []
  private diameters: number[] = []
  private types: string[] = []
  private colors: string[] = []
  private totalGrams?: number
  private estimatedMinutes?: number

  push(text: string) {
    const lines = (this.rest + text).split('\n')
    this.rest = lines.pop() ?? ''
    for (const line of lines) this.line(line)
  }

  plate(index: number, info?: PlateInfo): SlicedPlate {
    if (this.rest) this.line(this.rest)
    this.rest = ''
    const used = new Set(
      [...this.objects.values(), this.overhead].flatMap((lengths) => lengths.flatMap((length, slot) => (length ? [slot] : []))),
    )
    const slots = Math.max(this.densities.length, ...[...used].map((slot) => slot + 1), 1)
    const grams = (lengths: number[]) => Array.from({ length: slots }, (_, slot) => (lengths[slot] ?? 0) * this.gramsPerMm(slot))
    const named = info?.objects.filter(({ skipped }) => !skipped)
    const skipped = new Set(info?.objects.filter((object) => object.skipped).map(({ id }) => id))
    const ids = [
      ...(named?.map(({ id }) => id) ?? []),
      ...[...this.objects.keys()].filter((id) => !named?.some((object) => object.id === id) && !skipped.has(id)),
    ]
    const filaments = info?.filaments.length
      ? info.filaments.map(({ slot, type, color, usedGrams }) => this.filament(slot, type, color, usedGrams))
      : [...used].sort((left, right) => left - right).map((slot) => this.filament(slot, this.types[slot], this.colors[slot]))
    return {
      index,
      objects: ids.map((id) => ({
        id,
        ...(named && { name: named.find((object) => object.id === id)?.name }),
        grams: grams(this.objects.get(id) ?? []),
      })),
      overhead: grams(this.overhead),
      filaments,
      ...optional('slicerGrams', info?.weight ?? this.totalGrams),
      ...optional('minutes', info?.predictionSeconds !== undefined ? info.predictionSeconds / 60 : this.estimatedMinutes),
    }
  }

  private filament(slot: number, type?: string, color?: string, slicerGrams?: number): SlicedFilament {
    return {
      slot,
      ...optional('type', type || undefined),
      ...optional('color', color || undefined),
      density: this.densities[slot] ?? this.densities[0] ?? DEFAULT_DENSITY,
      diameter: this.diameters[slot] ?? this.diameters[0] ?? DEFAULT_DIAMETER,
      ...optional('slicerGrams', slicerGrams),
    }
  }

  private gramsPerMm(slot: number) {
    const { density, diameter } = this.filament(slot)
    return (Math.PI * (diameter / 2) ** 2 * density) / 1000
  }

  private line(raw: string) {
    const line = raw.trim()
    if (line.startsWith(';')) return this.comment(line)
    const code = line.split(';', 1)[0].trim()
    const command = code.split(/\s/, 1)[0].toUpperCase()
    if (command === 'M82') this.relative = false
    else if (command === 'M83') this.relative = true
    else if (command === 'G92') {
      const e = extrusion(code)
      if (e !== undefined) this.lastE = e
    } else if (/^T\d+$/.test(command)) {
      const tool = Number(command.slice(1))
      if (tool < (this.densities.length || MAX_SLOTS_UNSTATED)) this.slot = tool
    } else if (/^G0*[0-3]$/.test(command)) {
      const e = extrusion(code)
      if (e === undefined) return
      const length = this.relative ? e : e - this.lastE
      if (!this.relative) this.lastE = e
      const lengths = this.label === undefined ? this.overhead : this.objectLengths(this.label)
      lengths[this.slot] = (lengths[this.slot] ?? 0) + length
    }
  }

  private objectLengths(label: string) {
    let lengths = this.objects.get(label)
    if (!lengths) this.objects.set(label, (lengths = []))
    return lengths
  }

  private comment(line: string) {
    const start = /^;\s*start printing object, unique label id:\s*(\S+)/.exec(line)
    if (start) return void (this.label = start[1])
    if (/^;\s*stop printing object, unique label id:/.test(line)) return void (this.label = undefined)
    const setting = /^;\s*(filament_density|filament_diameter|filament_type|filament_colour)\s*[:=]\s*(.*)$/.exec(line)
    if (setting) {
      const [, key, value] = setting
      const list = value.split(/[,;]/).map((item) => item.trim())
      if (key === 'filament_density') this.densities = list.map(Number)
      else if (key === 'filament_diameter') this.diameters = list.map(Number)
      else if (key === 'filament_type') this.types = list
      else this.colors = list
      return
    }
    const weight = /^;\s*total filament weight \[g\]\s*:\s*(.+)$/.exec(line)
    if (weight) return void (this.totalGrams = weight[1].split(',').reduce((sum, grams) => sum + (Number(grams) || 0), 0))
    const time = /total estimated time:\s*([^;]+)/.exec(line)
    if (time) this.estimatedMinutes = durationMinutes(time[1])
  }
}

function extrusion(code: string) {
  const match = /\sE(-?\d*\.?\d+)/i.exec(code)
  return match ? Number(match[1]) : undefined
}

function durationMinutes(text: string) {
  const units: Record<string, number> = { d: 1440, h: 60, m: 1, s: 1 / 60 }
  let minutes = 0
  for (const [, amount, unit] of text.matchAll(/(\d+(?:\.\d+)?)\s*([dhms])/g)) minutes += Number(amount) * units[unit]
  return minutes || undefined
}

function optional<Key extends string, Value>(key: Key, value: Value | undefined) {
  return (value === undefined ? {} : { [key]: value }) as Partial<Record<Key, Value>>
}
