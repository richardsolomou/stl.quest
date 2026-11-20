import type { status as en } from '../en/status'

export const status: typeof en = {
  label: {
    todo: 'File d’attente',
    up_next: 'À suivre',
    in_progress: 'Impression',
    post_processing: 'Finition',
    done: 'Prêt',
  },
  rankLabel: {
    todo: 'dans la file',
    up_next: 'à suivre',
  },
}
