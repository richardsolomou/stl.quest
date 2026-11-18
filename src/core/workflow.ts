export type StatusId = string

export type WorkflowStatus = {
  id: StatusId
  label: string
  /** How a requester's rank among their own prints in this stage reads; stages without one run in the operator's order. */
  rankLabel?: string
}

export type WorkflowDefinition = { statuses: WorkflowStatus[] }

export const workflow: WorkflowDefinition = {
  statuses: [
    { id: 'todo', label: 'Queue', rankLabel: 'in queue' },
    { id: 'up_next', label: 'Up next', rankLabel: 'up next' },
    { id: 'in_progress', label: 'Printing' },
    { id: 'post_processing', label: 'Finishing' },
    { id: 'done', label: 'Ready' },
  ],
}

export function statusById(id: string): WorkflowStatus {
  const status = workflow.statuses.find((entry) => entry.id === id)
  if (!status) throw new Error('invalid status')
  return status
}

export function initialStatus(): WorkflowStatus {
  const status = workflow.statuses[0]
  if (!status) throw new Error('workflow has no statuses')
  return status
}

/** Whether any copy of a request has left the first stage. */
export function requestStarted(counts: Record<StatusId, number>) {
  return workflow.statuses.slice(1).some((status) => (counts[status.id] ?? 0) > 0)
}

export function isReadyStatus(id: string) {
  return id === workflow.statuses.at(-1)?.id
}
