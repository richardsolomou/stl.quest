import { useState } from 'react'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { usePostHog } from '@posthog/react'
import { Plus, X } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { PublicPrintRequest } from '../../core/types'
import type { WorkflowDefinition } from '../../core/workflow'
import { peopleQuery, sessionQuery } from '../queries'
import { requesterLabel } from '../requester'
import { deleteRequest, updateRequest } from '../../server/fns'
import { DialogShell } from './DialogShell'
import { ConfirmDialog } from './ConfirmDialog'
import { LazyStlViewer } from './LazyStlViewer'
import { PeopleCombobox } from './PeopleCombobox'
import { RequestDetails } from './RequestDetails'

export function RequestModal({
  request,
  workflow,
  isAdmin,
  hideRequester,
  onClose,
}: {
  request: PublicPrintRequest
  workflow: WorkflowDefinition
  isAdmin: boolean
  hideRequester: boolean
  onClose: () => void
}) {
  // Requesters may adjust copies/notes on their own request until any copy starts.
  const canEdit = request.canEdit
  const posthog = usePostHog()
  const { data: people } = useSuspenseQuery(peopleQuery())
  const { data: session } = useSuspenseQuery(sessionQuery())
  const printers = session.printers
  const showPrinterPicker = printers.length > 1 && printers.some((printer) => printer.technology === 'sla')
  const callUpdate = useServerFn(updateRequest)
  const callDelete = useServerFn(deleteRequest)
  const queryClient = useQueryClient()
  const [name, setName] = useState(request.name)
  const [quantity, setQuantity] = useState(String(request.quantity))
  const [forName, setForName] = useState(requesterLabel(request))
  const [notes, setNotes] = useState(request.notes ?? '')
  const [sourceUrl, setSourceUrl] = useState(request.sourceUrl ?? '')
  const [printerId, setPrinterId] = useState(request.printerId ?? printers[0]?.id ?? '')
  const [notesOpen, setNotesOpen] = useState(Boolean(request.notes))
  const [sourceOpen, setSourceOpen] = useState(Boolean(request.sourceUrl))
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState<'discard' | 'delete' | null>(null)

  const updateMutation = useMutation({
    mutationFn: callUpdate,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['requests'] })
      posthog.capture('request_updated', { request_id: request.id })
      onClose()
    },
    onError: (failure) => {
      posthog.captureException(failure, { action: 'update_request', request_id: request.id })
      setError("Couldn't save changes. Try again.")
    },
  })
  const deleteMutation = useMutation({
    mutationFn: callDelete,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['requests'] })
      onClose()
    },
    onError: (failure) => {
      posthog.captureException(failure, { action: 'delete_request', request_id: request.id })
      setError("Couldn't delete this request.")
    },
  })
  const busy = updateMutation.isPending || deleteMutation.isPending

  const dirty =
    canEdit &&
    (name !== request.name ||
      Number(quantity) !== request.quantity ||
      forName !== requesterLabel(request) ||
      notes !== (request.notes ?? '') ||
      sourceUrl !== (request.sourceUrl ?? '') ||
      printerId !== (request.printerId ?? printers[0]?.id ?? ''))

  const requestClose = () => {
    if (dirty) setConfirmation('discard')
    else onClose()
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    updateMutation.mutate({
      data: {
        id: request.id,
        name: name.trim() || request.name,
        quantity: Math.min(50, Math.max(1, Math.round(Number(quantity) || request.quantity))),
        requesterName: forName.trim(),
        notes: notes.trim(),
        sourceUrl: sourceUrl.trim(),
        printerId: printerId || null,
      },
    })
  }

  const remove = () => setConfirmation('delete')

  return (
    <>
      <DialogShell onClose={requestClose} title={request.name} preventClose={busy}>
        <LazyStlViewer requestId={request.id} hasPreview={request.hasPreview} />

        <RequestDetails request={request} workflow={workflow} people={people} hideRequester={hideRequester} showSource={!canEdit} />

        {!canEdit && request.notes && <p>{request.notes}</p>}

        {canEdit && (
          <form onSubmit={save}>
            <div className="mb-3 grid gap-3 sm:grid-cols-3 [&>[data-slot=field]]:min-w-0">
              {isAdmin && (
                <Field>
                  <FieldLabel htmlFor="request-name">Name</FieldLabel>
                  <Input id="request-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="request-qty">Copies</FieldLabel>
                <Input
                  id="request-qty"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={50}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </Field>
              {showPrinterPicker && (
                <Field>
                  <FieldLabel htmlFor="request-printer">Printer</FieldLabel>
                  <Select
                    items={printers.map((printer) => ({
                      value: printer.id,
                      label: `${printer.name} · ${printer.technology.toUpperCase()}`,
                    }))}
                    value={printerId}
                    onValueChange={(value) => value && setPrinterId(value)}
                  >
                    <SelectTrigger id="request-printer" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {printers.map((printer) => (
                        <SelectItem key={printer.id} value={printer.id}>
                          {printer.name} · {printer.technology.toUpperCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              {isAdmin && (
                <Field>
                  <FieldLabel htmlFor="request-for">For</FieldLabel>
                  <PeopleCombobox
                    id="request-for"
                    value={forName}
                    onChange={setForName}
                    options={[
                      ...(!people.some((person) => person.name === forName) ? [{ value: forName, label: forName }] : []),
                      ...people.map((person) => ({ value: person.name, label: person.name })),
                    ]}
                  />
                </Field>
              )}
            </div>
            {notesOpen && (
              <div className="mb-2.5 flex items-start gap-2">
                <Textarea
                  aria-label="Notes"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
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
                          setNotes('')
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
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://… where this model came from"
                  maxLength={500}
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
                          setSourceUrl('')
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
            <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
              {request.canDelete && (
                <Button type="button" variant="destructive" onClick={remove} disabled={busy}>
                  Delete
                </Button>
              )}
              <a
                className={cn(buttonVariants({ variant: 'outline' }))}
                href={`/api/files/${request.id}`}
                download
                onClick={() => posthog.capture('stl_downloaded', { request_id: request.id })}
              >
                Download STL
              </a>
              <Button type="submit" disabled={busy}>
                {busy && <Spinner />}
                {busy ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </form>
        )}

        {!canEdit && (
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
            <a
              className={cn(buttonVariants({ variant: 'outline' }))}
              href={`/api/files/${request.id}`}
              download
              onClick={() => posthog.capture('stl_downloaded', { request_id: request.id })}
            >
              Download STL
            </a>
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
        onCancel={() => setConfirmation(null)}
        onConfirm={() => (confirmation === 'delete' ? deleteMutation.mutate({ data: { id: request.id } }) : onClose())}
      />
    </>
  )
}
