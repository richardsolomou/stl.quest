import { useEffect, useRef, useState } from 'react'
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import type { Doc } from '../../convex/_generated/dataModel'
import { STATUS_LABELS, type Status } from '../../convex/statuses'
import { JobCard } from './JobCard'

const EMPTY_COPY: Record<Status, string> = {
  todo: 'Nothing queued.',
  in_progress: 'Printers are idle.',
  done: 'Nothing finished yet.',
  failed: 'No failed prints.',
}

export function Column({
  status,
  jobs,
  isAdmin,
  onDropJob,
  onOpenJob,
}: {
  status: Status
  jobs: Doc<'jobs'>[]
  isAdmin: boolean
  onDropJob: (jobId: string, status: Status) => void
  onOpenJob: (jobId: string) => void
}) {
  const ref = useRef<HTMLElement>(null)
  const [isOver, setIsOver] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element || !isAdmin) return
    return dropTargetForElements({
      element,
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: ({ source }) => {
        setIsOver(false)
        const jobId = source.data.jobId
        if (typeof jobId === 'string') onDropJob(jobId, status)
      },
    })
  }, [isAdmin, status, onDropJob])

  return (
    <section ref={ref} className={`column${isOver ? ' drop-target' : ''}`} data-status={status}>
      <header className="column-head">
        <span className="dot" />
        {STATUS_LABELS[status]}
        <span className="count">{jobs.length}</span>
      </header>
      <div className="column-body">
        {jobs.length === 0 && <div className="column-empty">{EMPTY_COPY[status]}</div>}
        {jobs.map((job) => (
          <JobCard key={job._id} job={job} canDrag={isAdmin} onOpen={() => onOpenJob(job._id)} />
        ))}
      </div>
    </section>
  )
}
