import { useEffect, useRef, useState } from 'react'
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import type { Doc } from '../../convex/_generated/dataModel'
import { STATUS_LABELS, type Status } from '../../convex/statuses'
import { JobCard } from './JobCard'

const EMPTY_COPY: Record<Status, string> = {
  todo: 'Nothing queued.',
  in_progress: 'Printers are idle.',
  done: 'Nothing finished yet.',
}

export function Column({
  status,
  entries,
  isAdmin,
  onOpenJob,
}: {
  status: Status
  entries: { job: Doc<'jobs'>; count: number }[]
  isAdmin: boolean
  onOpenJob: (jobId: string) => void
}) {
  const ref = useRef<HTMLElement>(null)
  const [isOver, setIsOver] = useState(false)

  useEffect(() => {
    const element = ref.current
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
        {STATUS_LABELS[status]}
        <span className="count">{total}</span>
      </header>
      <div className="column-body">
        {entries.length === 0 && <div className="column-empty">{EMPTY_COPY[status]}</div>}
        {entries.map(({ job, count }) => (
          <JobCard
            key={job._id}
            job={job}
            status={status}
            count={count}
            canDrag={isAdmin}
            onOpen={() => onOpenJob(job._id)}
          />
        ))}
      </div>
    </section>
  )
}
