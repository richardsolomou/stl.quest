import { useCallback, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import type { Doc } from '../../convex/_generated/dataModel'
import { STATUSES, type Status } from '../../convex/statuses'
import { moveJob } from '../server/fns'
import { Column } from './Column'

export function Board({
  jobs,
  isAdmin,
  onOpenJob,
}: {
  jobs: Doc<'jobs'>[]
  isAdmin: boolean
  onOpenJob: (jobId: string) => void
}) {
  const callMoveJob = useServerFn(moveJob)
  // Optimistic status overrides until the live query catches up.
  const [overrides, setOverrides] = useState<Record<string, Status>>({})

  const handleDrop = useCallback(
    (jobId: string, status: Status) => {
      setOverrides((prev) => ({ ...prev, [jobId]: status }))
      callMoveJob({ data: { id: jobId, status } })
        .catch(() => {})
        .finally(() =>
          setOverrides((prev) => {
            const { [jobId]: _dropped, ...rest } = prev
            return rest
          }),
        )
    },
    [callMoveJob],
  )

  const statusOf = (job: Doc<'jobs'>) => overrides[job._id] ?? job.status

  return (
    <main className="board">
      {STATUSES.map((status) => (
        <Column
          key={status}
          status={status}
          jobs={jobs.filter((job) => statusOf(job) === status)}
          isAdmin={isAdmin}
          onDropJob={handleDrop}
          onOpenJob={onOpenJob}
        />
      ))}
    </main>
  )
}
