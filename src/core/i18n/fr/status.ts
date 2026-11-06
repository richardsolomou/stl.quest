import type { status as en } from '../en/status'

export const status: typeof en = {
  label: {
    todo: 'File d’attente',
    up_next: 'À suivre',
    in_progress: 'Impression',
    post_processing: 'Finition',
    done: 'Prêt',
  },
  empty: {
    todo: 'Aucune impression en attente.',
    up_next: 'Aucune impression n’est prête à lancer ensuite.',
    in_progress: 'Aucune impression en cours.',
    post_processing: 'Aucune impression n’attend de nettoyage, de retrait des supports, de lavage ou de durcissement.',
    done: 'Aucune impression terminée n’est encore prête.',
  },
  rankLabel: {
    todo: 'dans la file',
    up_next: 'à suivre',
  },
}
