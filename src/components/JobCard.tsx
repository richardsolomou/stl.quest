import { useEffect, useRef, useState } from 'react'
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import type { Doc } from '../../convex/_generated/dataModel'

export function JobCard({
  job,
  canDrag,
  onOpen,
}: {
  job: Doc<'jobs'>
  canDrag: boolean
  onOpen: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element || !canDrag) return
    return draggable({
      element,
      getInitialData: () => ({ jobId: job._id }),
      onDragStart: () => setDragging(true),
      onDrop: () => setDragging(false),
    })
  }, [canDrag, job._id])

  const requester = job.requesterName ?? job.requesterEmail.split('@')[0]

  return (
    <button
      ref={ref}
      type="button"
      className={`card${canDrag ? ' draggable' : ''}${dragging ? ' dragging' : ''}`}
      onClick={onOpen}
    >
      <div className="thumb">
        {job.thumbnail ? <img src={job.thumbnail} alt="" /> : <span className="placeholder">stl</span>}
      </div>
      <div className="card-info">
        <div className="card-title">{job.name}</div>
        <div className="card-meta">
          <span className="chip qty">×{job.quantity}</span>
          {job.printer !== 'unassigned' && (
            <span className={`chip printer-${job.printer}`}>{job.printer}</span>
          )}
          {job.tags.map((tag) => (
            <span key={tag} className="chip">
              {tag}
            </span>
          ))}
        </div>
        <div className="card-requester">for {requester}</div>
      </div>
    </button>
  )
}
