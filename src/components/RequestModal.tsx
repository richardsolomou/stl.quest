import { Suspense, lazy, useState } from 'react'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { usePostHog } from '@posthog/react'
import type { PublicPrintRequest } from '../core/types'
import type { WorkflowDefinition } from '../core/workflow'
import { peopleQuery } from '../lib/queries'
import { requesterColor, requesterLabel } from '../lib/requester'
import { useEscape } from '../lib/useEscape'
import { deleteRequest, updateRequest } from '../server/fns'

const StlViewer = lazy(() => import('./StlViewer'))

function sourceLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

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
  const callUpdate = useServerFn(updateRequest)
  const callDelete = useServerFn(deleteRequest)
  const queryClient = useQueryClient()
  const [name, setName] = useState(request.name)
  const [quantity, setQuantity] = useState(String(request.quantity))
  const [forName, setForName] = useState(requesterLabel(request))
  const [notes, setNotes] = useState(request.notes ?? '')
  const [sourceUrl, setSourceUrl] = useState(request.sourceUrl ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const dirty =
    canEdit &&
    (name !== request.name ||
      Number(quantity) !== request.quantity ||
      forName !== requesterLabel(request) ||
      notes !== (request.notes ?? '') ||
      sourceUrl !== (request.sourceUrl ?? ''))

  const requestClose = () => {
    if (!dirty || confirm('Discard unsaved changes?')) onClose()
  }
  useEscape(requestClose)

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await callUpdate({
        data: {
          id: request.id,
          name: name.trim() || request.name,
          quantity: Math.min(50, Math.max(1, Math.round(Number(quantity) || request.quantity))),
          requesterName: forName.trim(),
          notes: notes.trim(),
          sourceUrl: sourceUrl.trim(),
        },
      })
      await queryClient.invalidateQueries({ queryKey: ['requests'] })
      posthog.capture('request_updated', {
        request_id: request.id,
      })
      onClose()
    } catch (error) {
      posthog.captureException(error, { action: 'update_request', request_id: request.id })
      setError("Couldn't save changes. Try again.")
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirm(`Delete "${request.name}"? This also deletes the STL from the NAS.`)) return
    setBusy(true)
    try {
      await callDelete({ data: { id: request.id } })
      await queryClient.invalidateQueries({ queryKey: ['requests'] })
      onClose()
    } catch (error) {
      posthog.captureException(error, { action: 'delete_request', request_id: request.id })
      setError("Couldn't delete this request.")
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && requestClose()}>
      <div className="dialog">
        <h2>{request.name}</h2>

        <Suspense fallback={<div className="viewer"><div className="viewer-status">loading viewer…</div></div>}>
          <StlViewer requestId={request.id} hasPreview={request.hasPreview} />
        </Suspense>

        <div className="modal-meta">
          <span className="chip qty">×{request.quantity}</span>
          {workflow.statuses.filter((status) => request.counts[status.id] > 0).map((status) => (
            <span key={status.id} className="chip">
              {request.counts[status.id]} {status.label.toLowerCase()}
            </span>
          ))}
          {!hideRequester && (
            <span
              className="chip"
              style={{ color: requesterColor(request, people), borderColor: requesterColor(request, people) }}
            >
              {requesterLabel(request)}
            </span>
          )}
        </div>

        {request.sourceUrl && (
          <p className="modal-source">
            Source:{' '}
            <a href={request.sourceUrl} target="_blank" rel="noopener noreferrer">
              {sourceLabel(request.sourceUrl)}
            </a>
          </p>
        )}

        {!canEdit && request.notes && <p>{request.notes}</p>}

        {canEdit && (
          <form onSubmit={save}>
            <div className="field-row">
              {isAdmin && (
                <div className="field">
                  <label htmlFor="request-name">Name</label>
                  <input id="request-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
                </div>
              )}
              <div className="field">
                <label htmlFor="request-qty">Copies</label>
                <input
                  id="request-qty"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={50}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
              {isAdmin && (
                <div className="field">
                  <label htmlFor="request-for">For</label>
                  <select id="request-for" value={forName} onChange={(e) => setForName(e.target.value)}>
                    {!people.some((person) => person.name === forName) && (
                      <option value={forName}>{forName}</option>
                    )}
                    {people.map((person) => (
                      <option key={person.name} value={person.name}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="field">
              <label htmlFor="request-notes">Notes</label>
              <textarea id="request-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="request-source">Source URL</label>
              <input
                id="request-source"
                type="url"
                inputMode="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://… where this model came from"
                maxLength={500}
              />
            </div>
            {error && <p className="error">{error}</p>}
            <div className="dialog-actions">
              {request.canDelete && (
                <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
                  Delete
                </button>
              )}
              <a
                className="btn"
                href={`/api/files/${request.id}`}
                download
                onClick={() => posthog.capture('stl_downloaded', { request_id: request.id })}
              >
                Download STL
              </a>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        )}

        {!canEdit && (
          <div className="dialog-actions">
            <a
              className="btn"
              href={`/api/files/${request.id}`}
              download
              onClick={() => posthog.capture('stl_downloaded', { request_id: request.id })}
            >
              Download STL
            </a>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
