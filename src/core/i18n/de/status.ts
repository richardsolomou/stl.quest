import type { status as en } from '../en/status'

export const status: typeof en = {
  label: {
    todo: 'Warteschlange',
    up_next: 'Als Nächstes',
    in_progress: 'Im Druck',
    post_processing: 'Nachbearbeitung',
    done: 'Fertig',
  },
  empty: {
    todo: 'Keine Drucke in der Warteschlange.',
    up_next: 'Keine Drucke sind als Nächstes vorbereitet.',
    in_progress: 'Gerade läuft kein Druck.',
    post_processing: 'Keine Drucke warten auf Reinigung, Entfernen der Stützen, Waschen oder Aushärten.',
    done: 'Noch keine fertigen Drucke.',
  },
  rankLabel: {
    todo: 'in der Warteschlange',
    up_next: 'als Nächstes',
  },
}
