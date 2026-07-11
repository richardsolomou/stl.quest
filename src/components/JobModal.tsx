import { Suspense, lazy, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import type { Doc } from '../../convex/_generated/dataModel'
import { PRINTERS, STATUS_LABELS, type Printer } from '../../convex/statuses'
import { deleteJob, updateJob } from '../server/fns'

const StlViewer = lazy(() => import('./StlViewer'))

export function JobModal({
  job,
  isAdmin,
  onClose,
}: {
  job: Doc<'jobs'>
  isAdmin: boolean
  onClose: () => void
}) {
  const callUpdate = useServerFn(updateJob)
  const callDelete = useServerFn(deleteJob)
  const [name, setName] = useState(job.name)
  const [quantity, setQuantity] = useState(job.quantity)
  const [printer, setPrinter] = useState<Printer>(job.printer)
  const [tags, setTags] = useState(job.tags.join(', '))
  const [notes, setNotes] = useState(job.notes ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const requester = job.requesterName ?? job.requesterEmail

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await callUpdate({
        data: {
          id: job._id,
          name: name.trim() || job.name,
          quantity: Math.min(50, Math.max(1, Math.round(quantity))),
          printer,
          tags: tags.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean).slice(0, 10),
          notes: notes.trim(),
        },
      })
      onClose()
    } catch {
      setError("Couldn't save changes. Try again.")
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirm(`Delete "${job.name}" from the board? The file stays on disk.`)) return
    setBusy(true)
    try {
      await callDelete({ data: { id: job._id } })
      onClose()
    } catch {
      setError("Couldn't delete this job.")
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog">
        <h2>{job.name}</h2>

        <Suspense fallback={<div className="viewer"><div className="viewer-status">loading viewer…</div></div>}>
          <StlViewer jobId={job._id} />
        </Suspense>

        <div className="modal-meta">
          <span className="chip qty">×{job.quantity}</span>
          <span className="chip">{STATUS_LABELS[job.status]}</span>
          {job.printer !== 'unassigned' && <span className={`chip printer-${job.printer}`}>{job.printer}</span>}
          {job.tags.map((tag) => (
            <span key={tag} className="chip">
              {tag}
            </span>
          ))}
          <span className="chip">for {requester}</span>
        </div>

        {!isAdmin && job.notes && <p>{job.notes}</p>}

        {isAdmin && (
          <form onSubmit={save}>
            <div className="field-row">
              <div className="field">
                <label htmlFor="job-name">Name</label>
                <input id="job-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
              </div>
              <div className="field">
                <label htmlFor="job-qty">Copies</label>
                <input
                  id="job-qty"
                  type="number"
                  min={1}
                  max={50}
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                />
              </div>
              <div className="field">
                <label htmlFor="job-printer">Printer</label>
                <select id="job-printer" value={printer} onChange={(e) => setPrinter(e.target.value as Printer)}>
                  {PRINTERS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="job-tags">Tags</label>
              <input id="job-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="job-notes">Notes</label>
              <textarea id="job-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            {error && <p className="error">{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
                Delete
              </button>
              <a className="btn" href={`/api/files/${job._id}`} download>
                Download STL
              </a>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        )}

        {!isAdmin && (
          <div className="dialog-actions">
            <a className="btn" href={`/api/files/${job._id}`} download>
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
