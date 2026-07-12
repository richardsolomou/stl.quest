import { useEffect, useRef, useState } from 'react'
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import type { StatusId, WorkflowStatus } from '../core/workflow'
import type { PublicPrintRequest } from '../core/types'
import { RequestCard } from './RequestCard'

export function Column({
  status,
  definition,
  entries,
  isAdmin,
  hideRequester,
  onOpenRequest,
}: {
  status: StatusId
  definition: WorkflowStatus
  entries: { request: PublicPrintRequest; count: number }[]
  isAdmin: boolean
  hideRequester: boolean
  onOpenRequest: (requestId: string) => void
}) {
  const ref = useRef<HTMLElement>(null)
  const [isOver, setIsOver] = useState(false)

  useEffect(() => {
    const element = ref.current
    // Columns as drop targets are for cross-status moves — operator only.
    if (!element || !isAdmin) return
    return dropTargetForElements({
      element,
      getData: () => ({ type: 'column', status }),
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    })
  }, [isAdmin, status])

  const total = entries.reduce((sum, entry) => sum + entry.count, 0)

  return (
    <section ref={ref} className={`column${isOver ? ' drop-target' : ''}`} data-status={status}>
      <header className="column-head">
        <span className="dot" />
        {definition.label}
        <span className="count">{total}</span>
      </header>
      <div className="column-body">
        {entries.length === 0 && <div className="column-empty">{definition.empty}</div>}
        {entries.map(({ request, count }) => (
          <RequestCard
            key={request.id}
            request={request}
            status={status}
            count={count}
            canDrag={isAdmin || request.mine}
            hideRequester={hideRequester}
            onOpen={() => onOpenRequest(request.id)}
          />
        ))}
      </div>
    </section>
  )
}
