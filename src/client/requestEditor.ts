import { normalizeRequestQuantity } from '../core/request'
import type { PrintType, PublicPrintRequest } from '../core/types'

export type RequestEditorValues = {
  name: string
  quantity: string
  notes: string
  sourceUrl: string
  printType: PrintType | ''
  printerId: string
}

export function requestEditorValues(request: PublicPrintRequest): RequestEditorValues {
  return {
    name: request.name,
    quantity: String(request.quantity),
    notes: request.notes ?? '',
    sourceUrl: request.sourceUrl ?? '',
    printType: request.printType ?? '',
    printerId: request.printer?.id ?? '',
  }
}

export function requestEditorDirty(request: PublicPrintRequest, values: RequestEditorValues) {
  const original = requestEditorValues(request)
  return (
    request.canEdit &&
    (values.name !== original.name ||
      Number(values.quantity) !== request.quantity ||
      values.notes !== original.notes ||
      values.sourceUrl !== original.sourceUrl ||
      values.printType !== original.printType ||
      values.printerId !== original.printerId)
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
  ].filter((field): field is string => field !== undefined)
}

export function requestUpdateData(workspaceSlug: string, request: PublicPrintRequest, values: RequestEditorValues, isAdmin: boolean) {
  if (!values.printType) return undefined
  const originalPrintType = request.printType ?? ''
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
  }
}
