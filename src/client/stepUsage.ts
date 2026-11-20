import { consumableUnit, type Consumable, type FilamentConsumable, type ResinConsumable } from '../core/consumables'
import { equipmentForStage, type EquipmentItem } from '../core/equipment'
import { requestPrintEstimate } from '../core/printEstimates'
import type { PrinterSummary, PrintType, PublicPrintRequest } from '../core/types'
import type { StepUsageInput, StockLevel, UsageEvent } from '../core/usage'
import type { StatusId, WorkflowStatus } from '../core/workflow'

/** The steps that ask what was used: starting to print, and starting to finish. */
export type UsageStep = StepUsageInput['stage']

const STEP_STATUSES: Record<UsageStep, StatusId> = { printing: 'in_progress', finishing: 'post_processing' }

/**
 * Copies of one print that reached a step and have not had their usage recorded or skipped yet, with the printer the
 * operator started them on when they picked one.
 */
export type StepMove = { requestId: string; step: UsageStep; copies: number; printerId?: string }

/** The step a move reaches when it moves forward onto printing or finishing; a move backwards or elsewhere asks nothing. */
export function stepReached(statuses: WorkflowStatus[], from: StatusId, to: StatusId): UsageStep | undefined {
  const index = (id: StatusId) => statuses.findIndex((status) => status.id === id)
  if (index(to) <= index(from)) return undefined
  return (Object.keys(STEP_STATUSES) as UsageStep[]).find((step) => STEP_STATUSES[step] === to)
}

/**
 * What is waiting to be recorded after some copies moved: a move forward onto printing or finishing joins the copies
 * already waiting there, so moves made while the sheet is open join it, and a move back out of a step drops that print's
 * wait for it, so a mistaken drop never records.
 */
export function noteStepMoves(
  pending: StepMove[],
  statuses: WorkflowStatus[],
  moved: { id: string; from: StatusId; to: StatusId; count: number; printerId?: string }[],
) {
  const index = (id: StatusId) => statuses.findIndex((status) => status.id === id)
  let next = pending.map((move) => ({ ...move }))
  for (const { id, from, to, count, printerId } of moved) {
    if (index(to) < index(from)) next = next.filter((move) => move.requestId !== id || index(STEP_STATUSES[move.step]) <= index(to))
    const step = stepReached(statuses, from, to)
    if (!step || count <= 0) continue
    const existing = next.find((move) => move.requestId === id && move.step === step && move.printerId === printerId)
    if (existing) existing.copies += count
    else next.push({ requestId: id, step, copies: count, ...(printerId && { printerId }) })
  }
  return next
}

export type JobMaterial = ResinConsumable | FilamentConsumable

/** What the workspace owns and has used, from which the sheet offers and prefills its choices. */
export type StepCatalog = {
  printers: PrinterSummary[]
  consumables: Consumable[]
  equipment: EquipmentItem[]
  /** Recent usage, newest first. */
  events: UsageEvent[]
}

type GroupMove = { request: PublicPrintRequest; copies: number; printerId?: string }

export type PrintingGroup = {
  /** The print type and the printer the group was prefilled with, so choices made for it survive later moves joining. */
  key: string
  printType: PrintType
  moves: GroupMove[]
  printers: PrinterSummary[]
  materials: JobMaterial[]
  /** Kit used before printing, such as filament dryers; optional and never prefilled, since a dried spool serves many prints. */
  preparation: EquipmentItem[]
  printerId?: string
  /** The operator picked the printer when starting, so the sheet states it rather than asking. */
  printerChosen: boolean
}

export type FinishingGroup = {
  key: string
  printType?: PrintType
  moves: GroupMove[]
  equipment: EquipmentItem[]
  equipmentIds: string[]
}

function printTypeOf(request: PublicPrintRequest) {
  return request.printType ?? request.printer?.printType
}

/** Live uses someone recorded, newest first; estimates of past prints were nobody's choice. */
function newestFirst(events: UsageEvent[]) {
  return events.filter((event) => event.kind === 'use' && !event.undoneAt && !event.estimated).sort((a, b) => b.createdAt - a.createdAt)
}

function only<T>(items: T[]) {
  return items.length === 1 ? items[0] : undefined
}

function groupMoves(moves: StepMove[], requests: PublicPrintRequest[], step: UsageStep) {
  const byId = new Map(requests.map((request) => [request.id, request]))
  return moves.flatMap((move) => {
    const request = move.step === step ? byId.get(move.requestId) : undefined
    return request ? [{ request, copies: move.copies, printerId: move.printerId }] : []
  })
}

/** The print's assigned printer, else the printer last used for its print type, else the only printer of that type. */
export function prefillPrinter(request: PublicPrintRequest, printType: PrintType, catalog: StepCatalog) {
  const printers = catalog.printers.filter((printer) => printer.printType === printType)
  const ids = new Set(printers.map(({ id }) => id))
  if (request.printer && ids.has(request.printer.id)) return request.printer.id
  const last = newestFirst(catalog.events).find((event) => event.stage === 'printing' && event.printerId && ids.has(event.printerId))
  return last?.printerId ?? only(printers)?.id
}

/** The material the printer last used, else the last one used for the print type, else the only one of that type. */
export function prefillMaterial(printType: PrintType, printerId: string | undefined, catalog: StepCatalog) {
  const materials = materialsFor(printType, catalog.consumables)
  const ids = new Set(materials.map(({ id }) => id))
  const used = newestFirst(catalog.events).filter(
    (event) => event.stage === 'printing' && event.consumableId !== undefined && ids.has(event.consumableId),
  )
  const last = (printerId && used.find((event) => event.printerId === printerId)) || used[0]
  return last?.consumableId ?? only(materials)?.id
}

export function materialsFor(printType: PrintType, consumables: Consumable[]) {
  return consumables.filter((consumable): consumable is JobMaterial => consumable.kind === printType && !consumable.archived)
}

/**
 * The finishing kit last used together for the print type, else the only piece there is. A recording counts for the
 * print type when its print is known to be of that type, or, for a print no longer on the board, when all its kit
 * still serves the type.
 */
export function prefillFinishing(
  printType: PrintType | undefined,
  catalog: StepCatalog,
  printTypes: Map<string, PrintType | undefined>,
): string[] {
  const available = equipmentForStage(catalog.equipment, 'finishing', printType)
  const ids = new Set(available.map(({ id }) => id))
  const transactions = new Map<string, { requestId?: string; equipmentIds: Set<string> }>()
  for (const event of newestFirst(catalog.events)) {
    if (event.stage !== 'finishing' || !event.equipmentId) continue
    const transaction = transactions.get(event.transactionId) ?? { requestId: event.requestId, equipmentIds: new Set<string>() }
    transaction.equipmentIds.add(event.equipmentId)
    transactions.set(event.transactionId, transaction)
  }
  for (const { requestId, equipmentIds } of transactions.values()) {
    const known = requestId !== undefined && printTypes.has(requestId)
    const matches = known ? printTypes.get(requestId) === printType : [...equipmentIds].every((id) => ids.has(id))
    const usable = [...equipmentIds].filter((id) => ids.has(id))
    if (matches && usable.length) return usable
  }
  const single = only(available)
  return single ? [single.id] : []
}

/**
 * Prints that started printing, grouped by print type and the printer they are prefilled with, so a bulk start asks once
 * per printer rather than once per print. Prints with no print type, and types the workspace has nothing to record for,
 * are left out.
 */
export function printingGroups(moves: StepMove[], requests: PublicPrintRequest[], catalog: StepCatalog): PrintingGroup[] {
  const groups = new Map<string, PrintingGroup>()
  for (const move of groupMoves(moves, requests, 'printing')) {
    const printType = printTypeOf(move.request)
    if (!printType) continue
    const printers = catalog.printers.filter((printer) => printer.printType === printType)
    const materials = materialsFor(printType, catalog.consumables)
    const preparation = equipmentForStage(catalog.equipment, 'before-printing', printType)
    if (!printers.length && !materials.length && !preparation.length) continue
    const chosen = printers.find(({ id }) => id === move.printerId)?.id
    const printerId = chosen ?? prefillPrinter(move.request, printType, catalog)
    const key = `${printType}:${printerId ?? ''}:${chosen ? 'chosen' : 'prefilled'}`
    const group = groups.get(key) ?? {
      key,
      printType,
      moves: [],
      printers,
      materials,
      preparation,
      printerId,
      printerChosen: Boolean(chosen),
    }
    group.moves.push(move)
    groups.set(key, group)
  }
  return [...groups.values()]
}

/** Prints that started finishing, grouped by print type; types with no finishing kit are left out. */
export function finishingGroups(moves: StepMove[], requests: PublicPrintRequest[], catalog: StepCatalog): FinishingGroup[] {
  const printTypes = new Map(requests.map((request) => [request.id, printTypeOf(request)]))
  const groups = new Map<string, FinishingGroup>()
  for (const move of groupMoves(moves, requests, 'finishing')) {
    const printType = printTypeOf(move.request)
    const equipment = equipmentForStage(catalog.equipment, 'finishing', printType)
    if (!equipment.length) continue
    const key = printType ?? ''
    const group = groups.get(key) ?? {
      key,
      printType,
      moves: [],
      equipment,
      equipmentIds: prefillFinishing(printType, catalog, printTypes),
    }
    group.moves.push(move)
    groups.set(key, group)
  }
  return [...groups.values()]
}

/** Nothing to choose when printing starts: the printer was picked or is the only one, and there is at most one material. */
export function printingSettled(group: PrintingGroup) {
  return (group.printerChosen || group.printers.length <= 1) && group.materials.length <= 1
}

/** Nothing to choose when finishing starts: a single piece of finishing kit for the print type. */
export function finishingSettled(group: FinishingGroup) {
  return group.equipment.length === 1
}

/** How much of its material a group's prints need from their estimates, in the material's stock unit; unknown estimates add nothing. */
export function materialNeeded(moves: GroupMove[], material: JobMaterial) {
  const unit = consumableUnit(material)
  return moves.reduce((total, { request, copies }) => {
    const estimate = requestPrintEstimate({ ...request, printType: material.kind })
    return estimate?.material && estimate.materialUnit === unit ? total + estimate.material * copies : total
  }, 0)
}

/** Materials whose tracked stock is less than what the chosen groups need, so the sheet can warn without stopping anyone. */
export function stockShortfalls(needs: { consumableId: string; amount: number }[], stock: StockLevel[]) {
  const totals = new Map<string, number>()
  for (const { consumableId, amount } of needs) totals.set(consumableId, (totals.get(consumableId) ?? 0) + amount)
  const shortfalls = new Map<string, { needed: number; onHand: number; unit: StockLevel['unit'] }>()
  for (const [consumableId, needed] of totals) {
    const level = stock.find((candidate) => candidate.consumableId === consumableId)
    if (level?.tracked && needed > 0 && needed > level.onHand)
      shortfalls.set(consumableId, { needed, onHand: Math.max(0, level.onHand), unit: level.unit })
  }
  return shortfalls
}

export type PrintingChoice = { printerId?: string; consumableId?: string; equipmentIds: string[] }

/** One recording per print for what the operator confirmed; a print with nothing chosen records nothing. */
export function stepUsageInputs(
  printing: { group: PrintingGroup; choice: PrintingChoice }[],
  finishing: { group: FinishingGroup; equipmentIds: string[] }[],
): StepUsageInput[] {
  const started = printing.flatMap(({ group, choice }) =>
    choice.printerId || choice.consumableId || choice.equipmentIds.length
      ? group.moves.map(({ request, copies }) => ({
          requestId: request.id,
          stage: 'printing' as const,
          copies,
          ...(choice.printerId && { printerId: choice.printerId }),
          ...(choice.consumableId && { consumableId: choice.consumableId }),
          ...(choice.equipmentIds.length && { equipmentIds: choice.equipmentIds }),
        }))
      : [],
  )
  const finished = finishing.flatMap(({ group, equipmentIds }) =>
    equipmentIds.length
      ? group.moves.map(({ request, copies }) => ({ requestId: request.id, stage: 'finishing' as const, copies, equipmentIds }))
      : [],
  )
  return [...started, ...finished]
}
