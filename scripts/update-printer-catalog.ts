import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CURA_REVISION = '572e9a33884ecc1e7ea05dc0ec635bca7fcbc64a'
const BAMBU_STUDIO_REVISION = 'ba4f27b169a3ccd82471a0e8e85f465c39bdd2be'
const UVTOOLS_REVISION = '865562dac0cc2c55b23f392c18a009537d706d4a'
const output = path.resolve(import.meta.dirname, '../src/data/printerCatalog.json')

type Technology = 'fdm' | 'sla'
type CatalogEntry = {
  id: string
  manufacturer: string
  model: string
  technology: Technology
  widthMm: number
  depthMm: number
  heightMm: number
  source: { project: 'bambu-studio' | 'cura' | 'uvtools'; upstreamId: string; revision: string }
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'printhub-printer-catalog-'))
try {
  const cura = checkout('https://github.com/Ultimaker/Cura.git', CURA_REVISION, 'resources/definitions', path.join(temporary, 'cura'))
  const bambuStudio = checkout(
    'https://github.com/bambulab/BambuStudio.git',
    BAMBU_STUDIO_REVISION,
    'resources/profiles/BBL/machine',
    path.join(temporary, 'bambu-studio'),
  )
  const uvtools = checkout('https://github.com/sn4k3/UVtools.git', UVTOOLS_REVISION, 'PrusaSlicer/printer', path.join(temporary, 'uvtools'))
  const entries = [
    ...bambuStudioEntries(path.join(bambuStudio, 'resources/profiles/BBL/machine')),
    ...curaEntries(path.join(cura, 'resources/definitions')),
    ...uvtoolsEntries(path.join(uvtools, 'PrusaSlicer/printer')),
  ].sort(
    (first, second) =>
      first.manufacturer.localeCompare(second.manufacturer) ||
      first.model.localeCompare(second.model) ||
      first.technology.localeCompare(second.technology),
  )
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, `${JSON.stringify(entries, null, 2)}\n`)
  console.log(`Wrote ${entries.length} printers to ${output}`)
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}

function checkout(repository: string, revision: string, sparsePath: string, destination: string) {
  fs.mkdirSync(destination)
  git(destination, 'init', '--quiet')
  git(destination, 'remote', 'add', 'origin', repository)
  git(destination, 'sparse-checkout', 'init', '--cone')
  git(destination, 'sparse-checkout', 'set', sparsePath)
  git(destination, 'fetch', '--quiet', '--depth', '1', 'origin', revision)
  git(destination, 'checkout', '--quiet', '--detach', 'FETCH_HEAD')
  return destination
}

function git(directory: string, ...arguments_: string[]) {
  execFileSync('git', arguments_, { cwd: directory, stdio: 'inherit' })
}

function curaEntries(directory: string): CatalogEntry[] {
  const definitions = new Map<string, CuraDefinition>()
  for (const file of fs.readdirSync(directory).filter((candidate) => candidate.endsWith('.def.json'))) {
    definitions.set(file.replace(/\.def\.json$/, ''), JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')) as CuraDefinition)
  }

  const chain = (id: string, seen = new Set<string>()): CuraDefinition[] => {
    if (seen.has(id)) return []
    seen.add(id)
    const definition = definitions.get(id)
    if (!definition) return []
    return [...(definition.inherits ? chain(definition.inherits, seen) : []), definition]
  }

  const inherited = <T>(definitions_: CuraDefinition[], read: (definition: CuraDefinition) => T | undefined) => {
    for (let index = definitions_.length - 1; index >= 0; index -= 1) {
      const definition = definitions_[index]
      if (!definition) continue
      const value = read(definition)
      if (value !== undefined) return value
    }
  }

  const setting = (definitions_: CuraDefinition[], key: string) =>
    inherited(definitions_, (definition) => definition.overrides?.[key]?.default_value ?? definition.settings?.[key]?.default_value)

  const entries: CatalogEntry[] = []
  for (const [id, definition] of definitions) {
    const definitions_ = chain(id)
    if (inherited(definitions_, (candidate) => candidate.metadata?.visible) !== true) continue
    const widthMm = setting(definitions_, 'machine_width')
    const depthMm = setting(definitions_, 'machine_depth')
    const heightMm = setting(definitions_, 'machine_height')
    const manufacturer = inherited(definitions_, (candidate) => candidate.metadata?.manufacturer)
    if (![widthMm, depthMm, heightMm].every((value) => typeof value === 'number' && value > 0) || !manufacturer) continue
    entries.push({
      id: `cura:${id}`,
      manufacturer: cleanManufacturer(manufacturer),
      model: definition.name.trim(),
      technology: 'fdm',
      widthMm: widthMm as number,
      depthMm: depthMm as number,
      heightMm: heightMm as number,
      source: { project: 'cura', upstreamId: id, revision: CURA_REVISION },
    })
  }
  return entries
}

function uvtoolsEntries(directory: string): CatalogEntry[] {
  return fs
    .readdirSync(directory)
    .filter((file) => file.endsWith('.ini'))
    .flatMap((file): CatalogEntry[] => {
      const profile = parseIni(fs.readFileSync(path.join(directory, file), 'utf8'))
      const displayWidthMm = Number(profile.display_width)
      const displayHeightMm = Number(profile.display_height)
      const widthMm = Math.max(displayWidthMm, displayHeightMm)
      const depthMm = Math.min(displayWidthMm, displayHeightMm)
      const heightMm = Number(profile.max_print_height)
      if (profile.printer_technology !== 'SLA' || ![widthMm, depthMm, heightMm].every((value) => value > 0)) return []
      const name = file.replace(/\.ini$/, '')
      const manufacturer = slaManufacturer(name)
      return [
        {
          id: `uvtools:${slug(name)}`,
          manufacturer,
          model: name.replace(new RegExp(`^${escapeRegExp(manufacturer)}\\s+`, 'i'), '').replace(/^UVtools Prusa\s+/i, ''),
          technology: 'sla',
          widthMm,
          depthMm,
          heightMm,
          source: { project: 'uvtools', upstreamId: file, revision: UVTOOLS_REVISION },
        },
      ]
    })
}

function bambuStudioEntries(directory: string): CatalogEntry[] {
  const definitions = new Map<string, BambuDefinition>()
  for (const file of fs.readdirSync(directory).filter((candidate) => candidate.endsWith('.json'))) {
    const definition = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')) as BambuDefinition
    definitions.set(definition.name, definition)
  }

  const chain = (name: string, seen = new Set<string>()): BambuDefinition[] => {
    if (seen.has(name)) return []
    seen.add(name)
    const definition = definitions.get(name)
    if (!definition) return []
    return [...(definition.inherits ? chain(definition.inherits, seen) : []), definition]
  }
  const inherited = <T>(definitions_: BambuDefinition[], read: (definition: BambuDefinition) => T | undefined) => {
    for (let index = definitions_.length - 1; index >= 0; index -= 1) {
      const definition = definitions_[index]
      if (!definition) continue
      const value = read(definition)
      if (value !== undefined) return value
    }
  }

  const profiles = [...definitions.values()]
    .filter((definition) => definition.instantiation === 'true' && definition.printer_model && definition.name.endsWith(' 0.4 nozzle'))
    .sort((first, second) => first.printer_model!.localeCompare(second.printer_model!))

  return profiles.flatMap((profile): CatalogEntry[] => {
    const definitions_ = chain(profile.name)
    const area = inherited(definitions_, (definition) => definition.printable_area)
    const heightMm = Number(inherited(definitions_, (definition) => definition.printable_height))
    const dimensions = area && printableAreaDimensions(area)
    if (!dimensions || heightMm <= 0 || !profile.printer_model) return []
    return [
      {
        id: `bambu-studio:${slug(profile.printer_model)}`,
        manufacturer: 'Bambu Lab',
        model: profile.printer_model.replace(/^Bambu Lab\s+/, ''),
        technology: 'fdm',
        ...dimensions,
        heightMm,
        source: { project: 'bambu-studio', upstreamId: `${profile.name}.json`, revision: BAMBU_STUDIO_REVISION },
      },
    ]
  })
}

function printableAreaDimensions(area: string[]) {
  const points = area.map((point) => point.split('x').map(Number))
  if (points.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return undefined
  const x = points.map(([value]) => value ?? 0)
  const y = points.map(([, value]) => value ?? 0)
  const widthMm = Math.max(...x) - Math.min(...x)
  const depthMm = Math.max(...y) - Math.min(...y)
  return widthMm > 0 && depthMm > 0 ? { widthMm, depthMm } : undefined
}

function parseIni(contents: string) {
  const entries: [string, string][] = []
  for (const line of contents.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator === -1) continue
    entries.push([line.slice(0, separator).trim(), line.slice(separator + 1).trim()])
  }
  return Object.fromEntries(entries)
}

function slaManufacturer(name: string) {
  if (name.startsWith('UVtools Prusa ')) return 'Prusa'
  return name.split(' ')[0]
}

function cleanManufacturer(manufacturer: string) {
  return manufacturer
    .replace(/\s+(B\.V\.|Ltd\.?|LLC|Inc\.?)$/i, '')
    .replace(/3D$/, '')
    .trim()
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

type CuraDefinition = {
  name: string
  inherits?: string
  metadata?: { visible?: boolean; manufacturer?: string }
  overrides?: Record<string, { default_value?: unknown }>
  settings?: Record<string, { default_value?: unknown }>
}

type BambuDefinition = {
  name: string
  inherits?: string
  instantiation?: string
  printer_model?: string
  printable_area?: string[]
  printable_height?: string
}
