import type { status as en } from '../en/status'

export const status: typeof en = {
  label: {
    todo: 'Warteschlange',
    up_next: 'Als Nächstes',
    in_progress: 'Im Druck',
    post_processing: 'Nachbearbeitung',
    done: 'Fertig',
  },
  rankLabel: {
    todo: 'in der Warteschlange',
    up_next: 'als Nächstes',
  },
}
