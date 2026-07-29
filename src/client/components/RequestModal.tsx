import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { usePostHog } from '@posthog/react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Person, PrinterSummary, PublicPrintRequest } from '../../core/types'
import { MAX_REQUEST_NAME_LENGTH, MAX_REQUEST_QUANTITY, MAX_REQUEST_SOURCE_URL_LENGTH, MIN_REQUEST_QUANTITY } from '../../core/request'
import { deleteRequest, updateRequest } from '../../server/fns'
import { DialogProblem } from './DialogProblem'
import { DialogShell } from './DialogShell'
import { ConfirmDialog } from './ConfirmDialog'
import { LazyStlViewer } from './LazyStlViewer'
import { RequestDetails } from './RequestDetails'
import { RequestDownloadButton } from './RequestDownloadButton'
import { availablePrintTypes, printTypeLabel } from '../fleet'
import { removeRequestFromQueries, restoreRequestQueries } from '../queries'
import { requestEditorDirty, requestEditorValues, requestUpdateData, type RequestEditorValues } from '../requestEditor'
import { useWorkspaceSlug } from '../workspace'

export function RequestModal({
  request,
  people,
  hideRequester,
  isAdmin,
  printers,
  onClose,
}: {
  request: PublicPrintRequest
  people: Person[]
  hideRequester: boolean
  isAdmin: boolean
  printers: PrinterSummary[]
  onClose: () => void
}) {
  const workspaceSlug = useWorkspaceSlug()
  // Requesters may adjust their own request until any copy starts.
  const canEdit = request.canEdit
  const posthog = usePostHog()
  const callUpdate = useServerFn(updateRequest)
  const callDelete = useServerFn(deleteRequest)
  const queryClient = useQueryClient()
  const [values, setValues] = useState(() => requestEditorValues(request))
  const patchValues = (patch: Partial<RequestEditorValues>) => setValues((current) => ({ ...current, ...patch }))
  const [notesOpen, setNotesOpen] = useState(Boolean(request.notes))
  const [sourceOpen, setSourceOpen] = useState(Boolean(request.sourceUrl))
  const [error, setError] = useState('')
  const [saveFailure, setSaveFailure] = useState('')
  const [confirmation, setConfirmation] = useState<'discard' | 'delete' | null>(null)
  const printTypes = availablePrintTypes()
  const selectedPrinter =
    request.printer?.id === values.printerId ? request.printer : printers.find((printer) => printer.id === values.printerId)

  const updateMutation = useMutation({
    mutationFn: callUpdate,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['requests'] })
      posthog.capture('request_updated', { print_type: values.printType })
      onClose()
    },
    onError: (failure) => {
      posthog.captureException(failure, { action: 'update_request', print_type: values.printType })
      setSaveFailure(failure instanceof Error && failure.message ? failure.message : 'The server did not accept the change.')
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
      posthog.captureException(failure, { action: 'delete_request', print_type: request.printType })
    },
  })
  const busy = updateMutation.isPending || deleteMutation.isPending

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
        <LazyStlViewer requestId={request.id} hasPreview={request.hasPreview} />

        <RequestDetails
          request={request}
          people={people}
          hideRequester={hideRequester}
          showMetadata={!canEdit}
          showPrintType={!canEdit}
          showPrinter={false}
          showSource={!canEdit}
        />

        {!canEdit && request.notes && <p>{request.notes}</p>}

        {canEdit && (
          <form onSubmit={save}>
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
            <div className="mb-3 mt-3 grid gap-3 sm:grid-cols-2 [&>[data-slot=field]]:min-w-0">
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
            {notesOpen && (
              <div className="mb-2.5 flex items-start gap-2">
                <Textarea
                  aria-label="Notes"
                  rows={3}
                  value={values.notes}
                  onChange={(event) => patchValues({ notes: event.target.value })}
                  placeholder="scale, supports, colour — anything the printer should know"
                />
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label="Remove note"
                        onClick={() => {
                          setNotesOpen(false)
                          patchValues({ notes: '' })
                        }}
                      />
                    }
                  >
                    <X />
                  </TooltipTrigger>
                  <TooltipContent>Remove note</TooltipContent>
                </Tooltip>
              </div>
            )}
            {sourceOpen && (
              <div className="mb-2.5 flex items-start gap-2">
                <Input
                  aria-label="Source URL"
                  type="url"
                  inputMode="url"
                  value={values.sourceUrl}
                  onChange={(event) => patchValues({ sourceUrl: event.target.value })}
                  placeholder="https://… where this model came from"
                  maxLength={MAX_REQUEST_SOURCE_URL_LENGTH}
                />
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label="Remove link"
                        onClick={() => {
                          setSourceOpen(false)
                          patchValues({ sourceUrl: '' })
                        }}
                      />
                    }
                  >
                    <X />
                  </TooltipTrigger>
                  <TooltipContent>Remove link</TooltipContent>
                </Tooltip>
              </div>
            )}
            {(!notesOpen || !sourceOpen) && (
              <div className="mb-3 grid gap-1 sm:flex sm:flex-wrap sm:gap-x-3">
                {!notesOpen && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-full justify-start px-2 text-xs text-muted-foreground sm:h-auto sm:w-auto sm:px-0"
                    onClick={() => setNotesOpen(true)}
                  >
                    <Plus />
                    Add note
                  </Button>
                )}
                {!sourceOpen && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-full justify-start px-2 text-xs text-muted-foreground sm:h-auto sm:w-auto sm:px-0"
                    onClick={() => setSourceOpen(true)}
                  >
                    <Plus />
                    Add link
                  </Button>
                )}
              </div>
            )}
            <FieldError>{error}</FieldError>
            <DialogProblem
              title="Your changes were not saved"
              hint="The print is unchanged. Check your connection and try again."
              error={saveFailure}
            />
            <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
              {request.canDelete && (
                <Button type="button" variant="destructive" onClick={remove} disabled={busy}>
                  Delete
                </Button>
              )}
              <RequestDownloadButton requestId={request.id} printType={request.printType} />
              <Button type="submit" disabled={busy}>
                {busy && <Spinner />}
                {busy ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </form>
        )}

        {!canEdit && (
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
            <RequestDownloadButton requestId={request.id} printType={request.printType} />
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </DialogShell>
      <ConfirmDialog
        open={confirmation !== null}
        title={confirmation === 'delete' ? `Delete “${request.name}”?` : 'Discard changes?'}
        description={confirmation === 'delete' ? 'This also deletes the STL from storage.' : 'Your unsaved edits will be lost.'}
        confirmLabel={confirmation === 'delete' ? 'Delete request' : 'Discard'}
        destructive
        pending={deleteMutation.isPending}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => (confirmation === 'delete' ? deleteMutation.mutate({ data: { workspaceSlug, id: request.id } }) : onClose())}
      />
    </>
  )
}
