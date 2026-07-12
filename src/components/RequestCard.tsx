import { useEffect, useRef, useState } from 'react'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import {
  attachClosestEdge,
  extractClosestEdge,
  type Edge,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { StatusId } from '../core/workflow'
import { peopleQuery } from '../lib/queries'
import type { PublicPrintRequest } from '../core/types'
import { LazyThumb } from './LazyThumb'
import { requesterColor, requesterLabel } from '../lib/requester'

export function RequestCard({
  request,
  status,
  count,
  canDrag,
  hideRequester,
  onOpen,
}: {
  request: PublicPrintRequest
  status: StatusId
  count: number
  canDrag: boolean
  hideRequester: boolean
  onOpen: () => void
}) {
  const { data: users } = useSuspenseQuery(peopleQuery())
  const ref = useRef<HTMLButtonElement>(null)
  const [dragging, setDragging] = useState(false)
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null)

  useEffect(() => {
    const element = ref.current
    if (!element || !canDrag) return
    return combine(
      draggable({
        element,
        getInitialData: () => ({ requestId: request.id, from: status }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
      }),
      dropTargetForElements({
        element,
        getData: ({ input, element: el }) =>
          attachClosestEdge(
            { type: 'card', requestId: request.id, status },
            { input, element: el, allowedEdges: ['top', 'bottom'] },
          ),
        onDrag: ({ self, source }) => {
          if (source.data.requestId !== request.id || source.data.from !== status) {
            setClosestEdge(extractClosestEdge(self.data))
          }
        },
        onDragLeave: () => setClosestEdge(null),
        onDrop: () => setClosestEdge(null),
      }),
    )
  }, [canDrag, request.id, status])

  return (
    <button
      ref={ref}
      type="button"
      className={`card${canDrag ? ' draggable' : ''}${dragging ? ' dragging' : ''}`}
      data-edge={closestEdge ?? undefined}
      onClick={onOpen}
    >
      {request.hasThumbnail ? (
        <LazyThumb requestId={request.id} />
      ) : (
        <div className="thumb">
          <span className="placeholder">stl</span>
        </div>
      )}
      <div className="card-info">
        <div className="card-title">{request.name}</div>
        <div className="card-meta">
          <span className="chip qty">{count === request.quantity ? `×${count}` : `×${count} of ${request.quantity}`}</span>
          {!hideRequester && (
            <span
              className="chip"
              style={{ color: requesterColor(request, users), borderColor: requesterColor(request, users) }}
            >
              {requesterLabel(request)}
            </span>
          )}
          {request.notes && (
            <span className="chip" title={request.notes}>
              ✎ notes
            </span>
          )}
        </div>
      </div>
    </button>
  )
}
