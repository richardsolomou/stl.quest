import type { Messages } from './i18n'
import type { ModelDimensions, PrinterProfile, PrintRequest, PrintType } from './types'
import { workflow } from './workflow'
import { getPrinterPreset, PRINTER_PRESETS } from './printerPresets'
import type { PrinterPreset } from './printerPresets'
import { isSlicerFor } from './slicers'

export const MAX_PRINTERS = 500
/** Set when an admin finishes printer setup without adding one, so setup is not offered again. */
export const PRINTERS_SKIPPED_SETTING = 'printers-skipped'

/** A catalogue printer takes its print type and build volume from its model; only a custom printer keeps its own. */
export function normalizePrinterProfile(profile: Partial<PrinterProfile> & Pick<PrinterProfile, 'id' | 'name'>): PrinterProfile {
  const preset = getPrinterPreset(profile.presetId) ?? inferredPrinterPreset(profile)
  const printType = preset?.printType ?? profile.printType ?? 'resin'
  return {
    id: profile.id,
    presetId: profile.presetId ?? preset?.id,
    widthMm: preset ? preset.widthMm : positiveNumber(profile.widthMm),
    depthMm: preset ? preset.depthMm : positiveNumber(profile.depthMm),
    heightMm: preset ? preset.heightMm : positiveNumber(profile.heightMm),
    name: profile.name,
    printType,
    ...(positiveNumber(profile.purchasePrice) ? { purchasePrice: profile.purchasePrice } : {}),
    ...(positiveNumber(profile.lifespanHours) ? { lifespanHours: profile.lifespanHours } : {}),
    ...(profile.purchasedOn ? { purchasedOn: profile.purchasedOn } : {}),
    ...(!preset && positiveNumber(profile.powerWatts) ? { powerWatts: profile.powerWatts } : {}),
    ...(profile.addOnPresetIds?.length ? { addOnPresetIds: profile.addOnPresetIds } : {}),
    ...(profile.slicer && isSlicerFor(profile.slicer, printType) ? { slicer: profile.slicer } : {}),
    ...(profile.archived ? { archived: true } : {}),
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
    name: printerModelName(preset),
    printType: preset.printType,
  }
}

export function printerModelName(preset: Pick<PrinterPreset, 'brand' | 'model'>) {
  return `${preset.brand} ${preset.model}`
}

/** The name, numbered when an active printer already has it, so a second identical machine is valid as soon as it is added. */
export function uniquePrinterName(name: string, profiles: PrinterProfile[]) {
  const taken = new Set(profiles.filter(({ archived }) => !archived).map((profile) => profile.name.trim().toLowerCase()))
  if (!taken.has(name.toLowerCase())) return name
  let number = 2
  while (taken.has(`${name} · ${number}`.toLowerCase())) number++
  return `${name} · ${number}`
}

/** Why `printer` cannot be stored among `profiles`, or '' if it can: an active printer needs a name no other active one has. */
export function printerValidationError(printer: PrinterProfile, profiles: PrinterProfile[], t: Messages) {
  if (printer.archived) return ''
  const name = printer.name.trim().toLowerCase()
  if (!name) return t.settings.printers.validation.missingName
  const taken = profiles.some((other) => other.id !== printer.id && !other.archived && other.name.trim().toLowerCase() === name)
  return taken ? t.settings.printers.validation.duplicateName : ''
}

export function printerProfilesValidationError(profiles: PrinterProfile[], t: Messages) {
  for (const profile of profiles) {
    const error = printerValidationError(profile, profiles, t)
    if (error) return error
  }
  return ''
}

export function printerProfileChanges(previous: PrinterProfile[], next: PrinterProfile[]) {
  previous = previous.filter(({ archived }) => !archived)
  next = next.filter(({ archived }) => !archived)
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
  const candidates = profiles.filter(
    (profile) => !profile.archived && profile.printType === printType && printerFitsModel(profile, modelDimensions),
  )
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

function positiveNumber(value?: number) {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined
}

function printerArea(printer: PrinterProfile) {
  return printer.widthMm && printer.depthMm ? printer.widthMm * printer.depthMm : undefined
}
