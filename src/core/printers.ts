import type { ModelDimensions, PrinterProfile, PrintRequest, PrintType } from './types'
import { workflow } from './workflow'
import { getPrinterPreset, PRINTER_PRESETS } from './printerPresets'
import type { PrinterPreset } from './printerPresets'

export const PRINTERS_SETTING = 'printers'

export function normalizePrinterProfile(profile: Partial<PrinterProfile> & Pick<PrinterProfile, 'id' | 'name'>): PrinterProfile {
  const preset = getPrinterPreset(profile.presetId) ?? inferredPrinterPreset(profile)
  return {
    id: profile.id,
    presetId: profile.presetId ?? preset?.id,
    widthMm: positiveDimension(profile.widthMm) ?? preset?.widthMm,
    depthMm: positiveDimension(profile.depthMm) ?? preset?.depthMm,
    heightMm: positiveDimension(profile.heightMm) ?? preset?.heightMm,
    name: profile.name,
    printType: profile.printType ?? preset?.printType ?? 'resin',
  }
}

export function nextPrinterPrintType(profiles: PrinterProfile[]): PrintType {
  if (!profiles.length) return 'resin'
  return profiles.every((profile) => profile.printType === 'resin') ? 'filament' : 'resin'
}

export function newPrinterProfile(id: string, printType: PrintType): PrinterProfile {
  return { id, name: '', printType }
}

export function printerProfileFromPreset(id: string, preset: PrinterPreset): PrinterProfile {
  return {
    id,
    presetId: preset.id,
    widthMm: preset.widthMm,
    depthMm: preset.depthMm,
    heightMm: preset.heightMm,
    name: `${preset.brand} ${preset.model}`,
    printType: preset.printType,
  }
}

export function printerProfilesValidationError(profiles: PrinterProfile[]) {
  const names = new Set<string>()
  for (const profile of profiles) {
    const name = profile.name.trim()
    if (!name) return 'Give every printer a name.'
    if (names.has(name.toLowerCase())) return 'Printer names must be unique.'
    names.add(name.toLowerCase())
  }
  return ''
}

export function printerProfileChanges(previous: PrinterProfile[], next: PrinterProfile[]) {
  const previousById = new Map(previous.map((profile) => [profile.id, normalizePrinterProfile(profile)]))
  const nextById = new Map(next.map((profile) => [profile.id, normalizePrinterProfile(profile)]))
  return {
    added_count: next.filter((profile) => !previousById.has(profile.id)).length,
    updated_count: next.filter((profile) => {
      const existing = previousById.get(profile.id)
      return existing !== undefined && JSON.stringify(existing) !== JSON.stringify(normalizePrinterProfile(profile))
    }).length,
    removed_count: previous.filter((profile) => !nextById.has(profile.id)).length,
  }
}

function inferredPrinterPreset(profile: Partial<PrinterProfile> & Pick<PrinterProfile, 'name'>) {
  const name = profile.name.trim().toLocaleLowerCase()
  const matches = PRINTER_PRESETS.filter((preset) => `${preset.brand} ${preset.model}`.toLocaleLowerCase() === name)
  return matches.find((preset) => !profile.printType || profile.printType === preset.printType) ?? matches[0]
}

export function automaticallyAssignedPrinter(
  profiles: PrinterProfile[],
  requests: Pick<PrintRequest, 'id' | 'printerId' | 'counts'>[],
  printType: PrintType,
  excludeRequestId?: string,
  modelDimensions?: ModelDimensions,
) {
  const candidates = profiles.filter((profile) => profile.printType === printType && printerFitsModel(profile, modelDimensions))
  if (!candidates.length) return undefined

  const knownAreas = candidates.map(printerArea).filter((area): area is number => area !== undefined)
  const fallbackArea = knownAreas.length ? knownAreas.reduce((sum, area) => sum + area, 0) / knownAreas.length : 1
  const workloads = new Map(candidates.map((printer) => [printer.id, 0]))
  const completedStatus = workflow.statuses.at(-1)!.id
  for (const request of requests) {
    if (request.id === excludeRequestId || !request.printerId || !workloads.has(request.printerId)) continue
    const outstandingCopies = Object.entries(request.counts).reduce(
      (sum, [status, count]) => sum + (status === completedStatus ? 0 : count),
      0,
    )
    workloads.set(request.printerId, workloads.get(request.printerId)! + outstandingCopies)
  }

  return candidates.reduce((best, candidate) => {
    const score = workloads.get(candidate.id)! / (printerArea(candidate) ?? fallbackArea)
    const bestScore = workloads.get(best.id)! / (printerArea(best) ?? fallbackArea)
    return score < bestScore ? candidate : best
  })
}

export function printerFitsModel(printer: PrinterProfile, model?: ModelDimensions) {
  if (!model) return true
  const normalized = normalizePrinterProfile(printer)
  const plateFits =
    !normalized.widthMm ||
    !normalized.depthMm ||
    (model.widthMm <= normalized.widthMm && model.depthMm <= normalized.depthMm) ||
    (model.widthMm <= normalized.depthMm && model.depthMm <= normalized.widthMm)
  return plateFits && (!normalized.heightMm || model.heightMm <= normalized.heightMm)
}

export async function storedPrinterProfiles(repository: { getSetting<T>(key: string): Promise<T | undefined> }) {
  const stored = (await repository.getSetting<PrinterProfile[]>(PRINTERS_SETTING)) ?? []
  return stored.map(normalizePrinterProfile)
}

function positiveDimension(value?: number) {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined
}

function printerArea(printer: PrinterProfile) {
  return printer.widthMm && printer.depthMm ? printer.widthMm * printer.depthMm : undefined
}
