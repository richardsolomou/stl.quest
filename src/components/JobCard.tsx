import { useEffect, useRef, useState } from 'react'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import {
  attachClosestEdge,
  extractClosestEdge,
  type Edge,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import type { Doc } from '../../convex/_generated/dataModel'
import { requesterColor, requesterLabel } from '../lib/requester'

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
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null)

  useEffect(() => {
    const element = ref.current
    if (!element || !canDrag) return
    return combine(
      draggable({
        element,
        getInitialData: () => ({ jobId: job._id }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
      }),
      dropTargetForElements({
        element,
        getData: ({ input, element: el }) =>
          attachClosestEdge({ type: 'card', jobId: job._id }, { input, element: el, allowedEdges: ['top', 'bottom'] }),
        onDrag: ({ self, source }) => {
          if (source.data.jobId !== job._id) setClosestEdge(extractClosestEdge(self.data))
        },
        onDragLeave: () => setClosestEdge(null),
        onDrop: () => setClosestEdge(null),
      }),
    )
  }, [canDrag, job._id])

  return (
    <button
      ref={ref}
      type="button"
      className={`card${canDrag ? ' draggable' : ''}${dragging ? ' dragging' : ''}`}
      data-edge={closestEdge ?? undefined}
      onClick={onOpen}
    >
      <div className="thumb">
        {job.thumbnail ? <img src={job.thumbnail} alt="" /> : <span className="placeholder">stl</span>}
      </div>
      <div className="card-info">
        <div className="card-title">{job.name}</div>
        <div className="card-meta">
          <span className="chip qty">×{job.quantity}</span>
          <span
            className="chip"
            style={{ color: requesterColor(job), borderColor: requesterColor(job) }}
          >
            {requesterLabel(job)}
          </span>
          {job.notes && (
            <span className="chip" title={job.notes}>
              ✎ notes
            </span>
          )}
        </div>
      </div>
    </button>
  )
}
