import { normalizeRequestQuantity } from '../core/request'
import type { PrintType, PublicPrintRequest } from '../core/types'

export type RequestEditorValues = {
  name: string
  quantity: string
  notes: string
  sourceUrl: string
  printType: PrintType | ''
  printerId: string
  estimatedMaterial: string
  estimatedMinutes: string
}

export function requestEditorValues(request: PublicPrintRequest): RequestEditorValues {
  return {
    name: request.name,
    quantity: String(request.quantity),
    notes: request.notes ?? '',
    sourceUrl: request.sourceUrl ?? '',
    printType: request.printType ?? '',
    printerId: request.printer?.id ?? '',
    estimatedMaterial: request.estimatedMaterialOverride?.toString() ?? '',
    estimatedMinutes: request.estimatedPrintMinutesOverride?.toString() ?? '',
  }
}

/** The model the editor will save: `cleared` drops the stored one, `file` puts a newly picked one in its place. */
export type StagedModel = { cleared: boolean; file?: File }

export const UNCHANGED_MODEL: StagedModel = { cleared: false }

/** What the dialog shows where the model goes. */
export function stagedModelState(request: Pick<PublicPrintRequest, 'hasFile'>, staged: StagedModel) {
  if (staged.file) return 'staged'
  if (request.hasFile && !staged.cleared) return 'stored'
  return 'empty'
}

/** A print that arrived with a model has to leave the editor with one, so saving waits for the replacement. */
export function stagedModelIncomplete(request: Pick<PublicPrintRequest, 'hasFile'>, staged: StagedModel) {
  return request.hasFile && staged.cleared && !staged.file
}

export function requestEditorDirty(request: PublicPrintRequest, values: RequestEditorValues, staged: StagedModel = UNCHANGED_MODEL) {
  const original = requestEditorValues(request)
  return (
    request.canEdit &&
    (staged.cleared ||
      staged.file !== undefined ||
      values.name !== original.name ||
      Number(values.quantity) !== request.quantity ||
      values.notes !== original.notes ||
      values.sourceUrl !== original.sourceUrl ||
      values.printType !== original.printType ||
      values.printerId !== original.printerId ||
      values.estimatedMaterial !== original.estimatedMaterial ||
      values.estimatedMinutes !== original.estimatedMinutes)
  )
}

export function requestChangedFields(request: PublicPrintRequest, values: RequestEditorValues) {
  const original = requestEditorValues(request)
  return [
    values.name.trim() !== original.name ? 'name' : undefined,
    normalizeRequestQuantity(values.quantity, request.quantity) !== request.quantity ? 'quantity' : undefined,
    values.notes.trim() !== original.notes ? 'notes' : undefined,
    values.sourceUrl.trim() !== original.sourceUrl ? 'source_url' : undefined,
    values.printType !== original.printType ? 'print_type' : undefined,
    values.printerId !== original.printerId ? 'printer' : undefined,
    values.estimatedMaterial !== original.estimatedMaterial ? 'estimated_material' : undefined,
    values.estimatedMinutes !== original.estimatedMinutes ? 'estimated_time' : undefined,
  ].filter((field): field is string => field !== undefined)
}

export function requestUpdateData(workspaceSlug: string, request: PublicPrintRequest, values: RequestEditorValues, isAdmin: boolean) {
  if (!values.printType) return undefined
  const originalPrintType = request.printType ?? ''
  const original = requestEditorValues(request)
  return {
    workspaceSlug,
    id: request.id,
    name: values.name.trim() || request.name,
    quantity: normalizeRequestQuantity(values.quantity, request.quantity),
    notes: values.notes.trim(),
    sourceUrl: values.sourceUrl.trim(),
    requestedPrintType: isAdmin
      ? values.printerId
        ? undefined
        : values.printType
      : values.printType !== originalPrintType
        ? values.printType
        : undefined,
    printerId: isAdmin ? values.printerId || null : undefined,
    ...(values.estimatedMaterial === original.estimatedMaterial
      ? {}
      : { estimatedMaterialOverride: positiveNumber(values.estimatedMaterial) }),
    ...(values.estimatedMinutes === original.estimatedMinutes
      ? {}
      : { estimatedPrintMinutesOverride: positiveNumber(values.estimatedMinutes) }),
  }
}

function positiveNumber(value: string) {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}
