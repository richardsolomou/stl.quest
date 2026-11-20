import type { shell as en } from '../en/shell'

const capitalize = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

export const shell: typeof en = {
  notFound: { title: 'Page introuvable', back: 'Retour au tableau' },
  rail: {
    goToBoard: 'Aller au tableau',
    mainNavigation: 'Navigation principale',
    board: 'Tableau',
    archive: 'Archives',
    calculator: 'Calculateur',
    settings: 'Paramètres',
    storageAvailable: (size) => `${size} de stockage disponibles`,
    includedStorage: 'Stockage inclus',
    storageUsedOf: (quota) => `utilisés sur ${quota}`,
    storageFull: 'Le stockage est plein : les nouveaux téléversements échoueront.',
    storageNearlyFull: 'Le stockage est presque plein.',
    upgradeTo: (plan) => `Passer à ${plan}`,
    viewPlan: 'Voir l’offre',
    updateAvailable: (version) => `STL Quest v${version} est disponible`,
  },
  settingsNav: {
    label: 'Sections des paramètres',
    choose: 'Choisir une section des paramètres',
    workspace: 'Espace de travail',
    production: 'Production',
    connections: 'Connexions',
    you: 'Vous',
    server: 'Serveur',
    product: 'STL Quest',
    account: 'Compte',
    plan: 'Formule',
    about: 'À propos',
  },
  setup: {
    steps: { storage: 'Stockage', printers: 'Imprimantes' },
    stepOf: (step, total) => `Étape ${step} sur ${total}`,
    progressLabel: (step, total, name) => `Étape de configuration ${step} sur ${total} : ${name}`,
  },
  tour: {
    questComplete: (title) => `Terminé : ${title}`,
    xpEarned: (points) => `+${points} XP gagnés`,
    viewOnboarding: 'Voir la prise en main',
    newQuestsAvailable: (count) => (count <= 1 ? `${count} nouvelle quête disponible.` : `${count} nouvelles quêtes disponibles.`),
    triggerLabel: (resolved, total, points, newCount) =>
      `STL Quest, ${resolved} sur ${total} résolues, ${points} XP${newCount ? `, ${newCount} ${newCount <= 1 ? 'nouvelle' : 'nouvelles'}` : ''}`,
    allComplete: 'Toutes les quêtes sont terminées',
    newQuests: (count) => (count <= 1 ? `${count} nouvelle quête` : `${count} nouvelles quêtes`),
    completeYourQuest: 'Terminez vos quêtes STL Quest',
    readyForNext: 'Prêt pour la prochaine quête',
    learnByDoing: 'Apprendre en pratiquant',
    xp: (points) => `${points} XP`,
    progress: (resolved, total, points, totalPoints) =>
      `${resolved} ${resolved <= 1 ? 'quête résolue' : 'quêtes résolues'} sur ${total} · ${points} XP gagnés sur ${totalPoints}`,
    summary: (completed, skipped) =>
      `${completed} ${completed <= 1 ? 'terminée' : 'terminées'} · ${skipped} ${skipped <= 1 ? 'ignorée' : 'ignorées'}`,
    reviewQuests: 'Revoir les quêtes',
    rowComplete: 'Terminée',
    showResolved: (count: number) => `Afficher ${count} terminées`,
    hideResolved: 'Masquer les terminées',
    rowSkipped: 'Ignorée',
    rowPoints: (points, isNew) => `${isNew ? 'Nouvelle · ' : ''}${points} XP`,
    restore: (title) => `Restaurer ${title}`,
    skip: (title) => `Ignorer ${title}`,
    notForMe: 'Pas pour moi',
    promptLabel: 'STL Quest',
    promptHeading: (points) => `STL Quest · +${points} XP`,
    closePrompt: 'Fermer l’invite de prise en main',
  },
  onboarding: {
    sections: {
      'getting-started': 'Premiers pas',
      optional: 'Facultatif',
    },
    quests: {
      printers: {
        title: 'Ajouter vos imprimantes',
        description:
          'Ajoutez chaque imprimante, pour que les impressions aillent à une machine adaptée et que les devis utilisent son coût de fonctionnement.',
      },
      stock: {
        resin: {
          title: 'Ajouter vos résines',
          description: 'Facultatif. Ajoutez les résines que vous utilisez et leur prix, pour que les devis utilisent vos prix.',
        },
        filament: {
          title: 'Ajouter vos filaments',
          description: 'Facultatif. Ajoutez les filaments que vous utilisez et leur prix, pour que les devis utilisent vos prix.',
        },
        both: {
          title: 'Ajouter vos matériaux',
          description:
            'Facultatif. Ajoutez les résines et filaments que vous utilisez et leur prix, pour que les devis utilisent vos prix.',
        },
      },
      upload: {
        title: 'Ajouter votre première impression',
        description: 'Téléversez un modèle ou enregistrez un lien pour alimenter la file d’attente.',
      },
      move: {
        title: 'Amener une impression à Prêt',
        description: 'Faites glisser une carte d’impression de la file d’attente vers Impression, Finition, puis Prêt.',
      },
      inspect: {
        title: 'Examiner une impression',
        description: 'Ouvrez une carte d’impression pour consulter son modèle, ses notes, ses copies et son attribution.',
      },
      download: { title: 'Télécharger un modèle', description: 'Téléchargez un STL depuis une carte d’impression ou sa vue détaillée.' },
      invite: {
        title: 'Inviter votre équipe',
        description: 'Créez une invitation à usage unique pour un demandeur ou un autre administrateur.',
      },
      tracking: {
        title: 'Suivre la consommation et le stock',
        description:
          'Facultatif. Indiquez ce que chaque impression a utilisé, et les stocks, les commandes, l’usure et les dépenses se comptent seuls. Activez-le ici.',
      },
    },
  },
  confirm: {
    noDetail: 'Aucun détail supplémentaire n’a été renvoyé.',
  },
  query: {
    requestFailed: 'La requête a échoué. Vérifiez votre connexion et réessayez.',
    retry: 'Réessayer',
    mutationFailed: 'Une erreur s’est produite. Veuillez réessayer.',
    staleServerFunction: 'STL Quest a été mis à jour. Actualisez la page pour continuer.',
  },
  routeError: {
    body: 'Le serveur n’a pas pu charger cette page. Actualisez pour réessayer, puis consultez les journaux du serveur si le problème persiste.',
    refresh: 'Actualiser',
  },
  release: {
    available: (version) => `STL Quest v${version} est disponible.`,
    viewWhatsNew: 'Voir les nouveautés',
    viewRelease: 'Voir la version',
  },
  updates: {
    couldNotLoad: 'STL Quest n’a pas pu terminer son chargement.',
    updated: 'STL Quest a été mis à jour.',
    refresh: 'Actualiser',
  },
  copyValue: (label) => `Copier ${label}`,
  datePicker: {
    clearDate: 'Effacer la date',
  },
  ui: {
    loading: 'Chargement',
    columns: 'Colonnes',
    itemCount: (count, label) => `${count} ${label}`,
    perPage: (size) => `${size} par page`,
    itemsPerPage: (items) => `${capitalize(items)} par page`,
    pageOf: (page, total) => `Page ${page} sur ${total}`,
    previous: 'Précédent',
    next: 'Suivant',
  },
}
