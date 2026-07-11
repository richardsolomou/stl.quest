export const STATUSES = ['todo', 'in_progress', 'done', 'failed'] as const
export type Status = (typeof STATUSES)[number]

export const STATUS_LABELS: Record<Status, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
  failed: 'Failed',
}

export const STATUS_FOLDERS: Record<Status, string> = {
  todo: 'todo',
  in_progress: 'in-progress',
  done: 'done',
  failed: 'failed',
}

export const PRINTERS = ['resin', 'fdm', 'unassigned'] as const
export type Printer = (typeof PRINTERS)[number]
