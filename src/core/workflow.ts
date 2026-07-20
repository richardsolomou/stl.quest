export type StatusId = string

export type WorkflowStatus = {
  id: StatusId
  label: string
  folder: string
  empty: string
}

export type WorkflowDefinition = { statuses: WorkflowStatus[] }

export const workflow: WorkflowDefinition = {
  statuses: [
    { id: 'todo', label: 'Queue', folder: 'todo', empty: 'No prints are waiting.' },
    { id: 'up_next', label: 'Up next', folder: 'up-next', empty: 'No prints are prepared to run next.' },
    { id: 'in_progress', label: 'Printing', folder: 'in-progress', empty: 'No prints are currently running.' },
    {
      id: 'post_processing',
      label: 'Finishing',
      folder: 'post-processing',
      empty: 'No prints are waiting for cleanup, support removal, washing, or curing.',
    },
    { id: 'done', label: 'Ready', folder: 'done', empty: 'No finished prints are ready yet.' },
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
