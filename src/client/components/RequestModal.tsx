import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { usePostHog } from '@posthog/react'
import { Link2, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import type { Person, PrinterSummary, PublicPrintRequest } from '../../core/types'
import {
  canAttachModel,
  MAX_REQUEST_NAME_LENGTH,
  MAX_REQUEST_QUANTITY,
  MAX_REQUEST_SOURCE_URL_LENGTH,
  MIN_REQUEST_QUANTITY,
} from '../../core/request'
import { deleteRequest, moveCopies, updateRequest } from '../../server/fns'
import { DialogProblem } from './DialogProblem'
import { DialogShell } from './DialogShell'
import { ConfirmDialog } from './ConfirmDialog'
import { LazyStlViewer } from './LazyStlViewer'
import { RequestDetails } from './RequestDetails'
import { RequestDownloadButton } from './RequestDownloadButton'
import { MoveDialog } from './MoveDialog'
import { AddOptionalFieldButton, RemovableField } from './OptionalFieldControls'
import { availablePrintTypes, printTypeLabel } from '../fleet'
import { errorMessage, isReportableMutationError } from '../../core/error'
import { removeRequestFromQueries, restoreRequestQueries } from '../queries'
import {
  requestChangedFields,
  requestEditorDirty,
  requestEditorValues,
  requestUpdateData,
  type RequestEditorValues,
} from '../requestEditor'
import { useWorkspaceSlug } from '../workspace'
import { useModelAttachment } from '../modelAttachment'
import { workflow } from '../../core/workflow'
import { formatEstimateMaterial, formatEstimateTime } from '../../core/printEstimates'
import { SourcePreviewImage } from './SourcePreviewImage'
import { AttachModelButton } from './AttachModelButton'

export function RequestModal({
  request,
  people,
  hideRequester,
  isAdmin,
  printers,
  uploadsEnabled,
  droppedModel,
  onDroppedModelHandled,
  onClose,
}: {
  request: PublicPrintRequest
  people: Person[]
  hideRequester: boolean
  isAdmin: boolean
  printers: PrinterSummary[]
  uploadsEnabled: boolean
  droppedModel?: File
  onDroppedModelHandled: () => void
  onClose: () => void
}) {
  const workspaceSlug = useWorkspaceSlug()
  // Requesters may adjust their own request until any copy starts.
  const canEdit = request.canEdit
  const posthog = usePostHog()
  const callUpdate = useServerFn(updateRequest)
  const callDelete = useServerFn(deleteRequest)
  const callMoveCopies = useServerFn(moveCopies)
  const queryClient = useQueryClient()
  const attachment = useModelAttachment(request)
  const canAttach = canAttachModel(request, uploadsEnabled)
  // A file dropped while this dialog is open belongs to this print, not to a new one.
  useEffect(() => {
    if (!droppedModel) return
    onDroppedModelHandled()
    if (canAttach) attachment.start(droppedModel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droppedModel])
  const [values, setValues] = useState(() => requestEditorValues(request))
  const [editing, setEditing] = useState(false)
  const patchValues = (patch: Partial<RequestEditorValues>) => setValues((current) => ({ ...current, ...patch }))
  const [notesOpen, setNotesOpen] = useState(Boolean(request.notes))
  const [sourceOpen, setSourceOpen] = useState(Boolean(request.sourceUrl))
  const [error, setError] = useState('')
  const [saveFailure, setSaveFailure] = useState('')
  const [confirmation, setConfirmation] = useState<'discard' | 'delete' | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const printTypes = availablePrintTypes()
  const selectedPrinter =
    request.printer?.id === values.printerId ? request.printer : printers.find((printer) => printer.id === values.printerId)
  const automaticEstimate = {
    material: request.automaticEstimatedMaterial,
    materialUnit: request.estimatedMaterialUnit,
    minutes: request.automaticEstimatedPrintMinutes,
  }

  const updateMutation = useMutation({
    mutationFn: callUpdate,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['requests'] })
      const changedFields = requestChangedFields(request, values)
      posthog.capture('request_updated', {
        print_type: values.printType,
        changed_fields: changedFields,
        changed_field_count: changedFields.length,
        has_started: Object.entries(request.counts).some(([status, count]) => status !== 'todo' && count > 0),
      })
      onClose()
    },
    onError: (failure) => {
      if (isReportableMutationError(failure)) posthog.captureException(failure, { action: 'update_request', print_type: values.printType })
      setSaveFailure(errorMessage(failure, 'The server did not accept the change.'))
    },
  })
  const deleteMutation = useMutation({
    mutationFn: callDelete,
    onMutate: async ({ data }) => {
      const snapshots = await removeRequestFromQueries(queryClient, workspaceSlug, data.id)
      onClose()
      return snapshots
    },
    onError: (failure, _variables, snapshots) => {
      if (snapshots) restoreRequestQueries(queryClient, snapshots)
      if (isReportableMutationError(failure)) posthog.captureException(failure, { action: 'delete_request', print_type: request.printType })
    },
  })
  const moveMutation = useMutation({
    mutationFn: callMoveCopies,
    onError: (failure) => {
      if (isReportableMutationError(failure))
        posthog.captureException(failure, { action: 'move_request_copies', print_type: request.printType, from: 'todo', to: 'up_next' })
    },
  })
  const busy = updateMutation.isPending || deleteMutation.isPending || moveMutation.isPending
  const queuedCopies = request.counts.todo ?? 0

  const dirty = requestEditorDirty(request, values)

  const requestClose = () => {
    if (dirty) setConfirmation('discard')
    else onClose()
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setSaveFailure('')
    const data = requestUpdateData(workspaceSlug, request, values, isAdmin)
    if (!data) {
      setError('Choose resin or filament.')
      return
    }
    updateMutation.mutate({ data })
  }

  const remove = () => setConfirmation('delete')

  return (
    <>
      <DialogShell
        onClose={requestClose}
        title={request.name}
        className="bg-ticket text-ticket-foreground"
        contentClassName="space-y-0"
        preventClose={busy}
      >
        {request.hasFile ? (
          <LazyStlViewer requestId={request.id} hasPreview={request.hasPreview} />
        ) : (
          <SourcePreviewImage
            key={request.id}
            requestId={request.id}
            className="mb-3 h-40 w-full rounded-lg border border-ticket-foreground/15 bg-background object-contain [background-image:var(--grid)] sm:h-48"
            fallback={
              <div className="mb-3 grid h-40 place-items-center rounded-lg border-2 border-dashed border-primary/25 bg-primary/5">
                <Link2 className="size-10 text-primary" />
              </div>
            }
          />
        )}

        <RequestDetails
          request={request}
          people={people}
          hideRequester={hideRequester}
          showMetadata={!editing}
          showPrintType={!editing}
          showPrinter={!editing}
          showSource={!editing}
        />

        {!editing && request.notes && (
          <div className="mb-3">
            <div className="mb-1 text-xs text-muted-foreground">Notes</div>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{request.notes}</p>
          </div>
        )}

        {canEdit && editing && (
          <form className="space-y-3" onSubmit={save}>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_5.5rem] [&>[data-slot=field]]:min-w-0">
              <Field>
                <FieldLabel htmlFor="request-name">Name</FieldLabel>
                <Input
                  id="request-name"
                  value={values.name}
                  onChange={(event) => patchValues({ name: event.target.value })}
                  maxLength={MAX_REQUEST_NAME_LENGTH}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="request-qty">Copies</FieldLabel>
                <Input
                  id="request-qty"
                  type="number"
                  inputMode="numeric"
                  min={MIN_REQUEST_QUANTITY}
                  max={MAX_REQUEST_QUANTITY}
                  value={values.quantity}
                  onChange={(event) => patchValues({ quantity: event.target.value })}
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 [&>[data-slot=field]]:min-w-0">
              <Field>
                <FieldLabel htmlFor="request-print-type">Print type</FieldLabel>
                <Select
                  items={printTypes.map((value) => ({ value, label: printTypeLabel(value) }))}
                  value={values.printType}
                  onValueChange={(value) => {
                    patchValues({ printType: value ?? '', printerId: '' })
                  }}
                >
                  <SelectTrigger id="request-print-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {printTypes.map((value) => (
                      <SelectItem key={value} value={value}>
                        {printTypeLabel(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {isAdmin && (
                <Field>
                  <FieldLabel htmlFor="request-printer">Printer</FieldLabel>
                  <Select
                    value={values.printerId || null}
                    onValueChange={(value) => {
                      const nextPrinter = printers.find((printer) => printer.id === value)
                      patchValues({
                        printerId: nextPrinter?.id ?? '',
                        ...(nextPrinter ? { printType: nextPrinter.printType } : {}),
                      })
                    }}
                  >
                    <SelectTrigger id="request-printer" className="w-full" aria-label="Printer">
                      <SelectValue>
                        {selectedPrinter
                          ? selectedPrinter.name
                          : request.fitState === 'none'
                            ? 'No compatible printer'
                            : 'Best available printer'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {printers.map((printer) => (
                        <SelectItem key={printer.id} value={printer.id}>
                          {printer.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 [&>[data-slot=field]]:min-w-0">
              <Field>
                <FieldLabel htmlFor="request-material-estimate">
                  Material ({automaticEstimate?.materialUnit ?? (values.printType === 'resin' ? 'ml' : 'g')})
                </FieldLabel>
                <Input
                  id="request-material-estimate"
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="any"
                  value={values.estimatedMaterial}
                  placeholder={
                    automaticEstimate?.material === undefined
                      ? estimatePlaceholder(request.estimateGeometryStatus)
                      : `≈${formatEstimateMaterial(automaticEstimate.material)}`
                  }
                  onChange={(event) => patchValues({ estimatedMaterial: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="request-time-estimate">Print time (minutes)</FieldLabel>
                <Input
                  id="request-time-estimate"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  value={values.estimatedMinutes}
                  placeholder={
                    automaticEstimate?.minutes === undefined
                      ? estimatePlaceholder(request.estimateGeometryStatus)
                      : `≈${formatEstimateTime(automaticEstimate.minutes)}`
                  }
                  onChange={(event) => patchValues({ estimatedMinutes: event.target.value })}
                />
              </Field>
              <p className="text-xs text-muted-foreground sm:col-span-2">Leave either empty to use the automatic estimate.</p>
            </div>
            {notesOpen && (
              <RemovableField
                removeLabel="Remove note"
                onRemove={() => {
                  setNotesOpen(false)
                  patchValues({ notes: '' })
                }}
              >
                <Field className="min-w-0 flex-1">
                  <FieldLabel htmlFor="request-notes">Notes</FieldLabel>
                  <Textarea
                    id="request-notes"
                    rows={3}
                    value={values.notes}
                    onChange={(event) => patchValues({ notes: event.target.value })}
                    placeholder="scale, supports, colour — anything the printer should know"
                  />
                </Field>
              </RemovableField>
            )}
            {sourceOpen && (
              <RemovableField
                removeLabel="Remove link"
                onRemove={
                  request.hasFile
                    ? () => {
                        setSourceOpen(false)
                        patchValues({ sourceUrl: '' })
                      }
                    : undefined
                }
              >
                <Field className="min-w-0 flex-1">
                  <FieldLabel htmlFor="request-source">Source link</FieldLabel>
                  <Input
                    id="request-source"
                    type="url"
                    inputMode="url"
                    value={values.sourceUrl}
                    onChange={(event) => patchValues({ sourceUrl: event.target.value })}
                    placeholder="https://… where this model came from"
                    maxLength={MAX_REQUEST_SOURCE_URL_LENGTH}
                  />
                </Field>
              </RemovableField>
            )}
            {(!notesOpen || !sourceOpen) && (
              <div className="grid gap-1 sm:flex sm:flex-wrap sm:gap-x-3">
                {!notesOpen && <AddOptionalFieldButton label="Add note" onClick={() => setNotesOpen(true)} />}
                {!sourceOpen && <AddOptionalFieldButton label="Add link" onClick={() => setSourceOpen(true)} />}
              </div>
            )}
            <FieldError>{error}</FieldError>
            <DialogProblem
              title="Your changes were not saved"
              hint="The print is unchanged. Check your connection and try again."
              error={saveFailure}
            />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
              {request.canDelete && (
                <Button type="button" variant="destructive" onClick={remove} disabled={busy}>
                  Delete
                </Button>
              )}
              {request.hasFile && <RequestDownloadButton requestId={request.id} printType={request.printType} />}
              {isAdmin && queuedCopies > 0 && (
                <Button type="button" variant="outline" disabled={busy} onClick={() => setMoveOpen(true)}>
                  Move copies…
                </Button>
              )}
              <Button type="submit" disabled={busy}>
                {busy && <Spinner />}
                {busy ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </form>
        )}

        {!editing && (
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
            {canAttach && <AttachModelButton attachment={attachment} />}
            {request.hasFile && <RequestDownloadButton requestId={request.id} printType={request.printType} />}
            {isAdmin && queuedCopies > 0 && (
              <Button type="button" variant="outline" disabled={busy} onClick={() => setMoveOpen(true)}>
                Move copies…
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose}>
              Done
            </Button>
            {canEdit && (
              <Button type="button" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
            )}
          </div>
        )}
      </DialogShell>
      {moveOpen && (
        <MoveDialog
          requestName={request.name}
          destinations={workflow.statuses.slice(1).map(({ id, label }) => ({ id, label }))}
          max={queuedCopies}
          pending={moveMutation.isPending}
          error={moveMutation.error ? errorMessage(moveMutation.error, 'The server did not accept the move.') : undefined}
          onCancel={() => setMoveOpen(false)}
          onConfirm={(count, destination) => {
            if (!destination) return
            moveMutation.mutate({ data: { workspaceSlug, id: request.id, from: 'todo', to: destination, count } }, { onSuccess: onClose })
          }}
        />
      )}
      <ConfirmDialog
        open={attachment.confirming !== undefined}
        title={`Replace the model on “${request.name}”?`}
        description={`${attachment.confirming?.name ?? 'The new file'} takes the place of the current model. The old file is deleted, and the preview and estimates are worked out again.`}
        confirmLabel="Replace model"
        destructive
        onCancel={attachment.cancel}
        onConfirm={attachment.confirm}
      />
      <DialogProblem
        title={attachment.replacing ? 'The model was not replaced' : 'The model was not attached'}
        hint={attachment.replacing ? 'The print still has its original model. Try again.' : 'The saved link is unchanged. Try again.'}
        error={attachment.error}
      />
      <ConfirmDialog
        open={confirmation !== null}
        title={confirmation === 'delete' ? `Delete “${request.name}”?` : 'Discard changes?'}
        description={
          confirmation === 'delete'
            ? request.hasFile
              ? 'This also deletes the model from storage.'
              : 'This removes the linked print from the queue.'
            : 'Your unsaved edits will be lost.'
        }
        confirmLabel={confirmation === 'delete' ? 'Delete request' : 'Discard'}
        destructive
        pending={deleteMutation.isPending}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => (confirmation === 'delete' ? deleteMutation.mutate({ data: { workspaceSlug, id: request.id } }) : onClose())}
      />
    </>
  )
}

function estimatePlaceholder(status: PublicPrintRequest['estimateGeometryStatus']) {
  return status === 'pending' || status === 'running' ? 'Calculating…' : 'Not available'
}
