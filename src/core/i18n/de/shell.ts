import type { shell as en } from '../en/shell'

const capitalize = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

export const shell: typeof en = {
  notFound: { title: 'Seite nicht gefunden', back: 'Zurück zum Board' },
  rail: {
    goToBoard: 'Zum Board',
    mainNavigation: 'Hauptnavigation',
    board: 'Board',
    archive: 'Archiv',
    calculator: 'Rechner',
    settings: 'Einstellungen',
    storageAvailable: (size) => `${size} Speicher verfügbar`,
    includedStorage: 'Inklusiver Speicher',
    storageUsedOf: (quota) => `von ${quota} belegt`,
    storageFull: 'Der Speicher ist voll, neue Uploads schlagen daher fehl.',
    storageNearlyFull: 'Der Speicher ist fast voll.',
    upgradeTo: (plan) => `Auf ${plan} upgraden`,
    viewPlan: 'Tarif ansehen',
    updateAvailable: (version) => `STL Quest v${version} ist verfügbar`,
  },
  settingsNav: {
    label: 'Einstellungsbereiche',
    choose: 'Einstellungsbereich wählen',
    workspace: 'Arbeitsbereich',
    production: 'Produktion',
    connections: 'Verbindungen',
    you: 'Persönlich',
    server: 'Server',
    product: 'STL Quest',
    account: 'Konto',
    plan: 'Tarif',
    about: 'Über',
  },
  setup: {
    steps: { storage: 'Speicher', printers: 'Drucker' },
    stepOf: (step, total) => `Schritt ${step} von ${total}`,
    progressLabel: (step, total, name) => `Einrichtungsschritt ${step} von ${total}: ${name}`,
  },
  tour: {
    questComplete: (title) => `${title} abgeschlossen`,
    xpEarned: (points) => `+${points} XP erhalten`,
    viewOnboarding: 'Einführung ansehen',
    newQuestsAvailable: (count) => (count === 1 ? `${count} neue STL Quest verfügbar.` : `${count} neue STL Quests verfügbar.`),
    triggerLabel: (resolved, total, points, newCount) =>
      `STL Quest, ${resolved} von ${total} erledigt, ${points} XP${newCount ? `, ${newCount} neu` : ''}`,
    allComplete: 'STL Quest abgeschlossen',
    newQuests: (count) => (count === 1 ? `${count} neue Quest` : `${count} neue Quests`),
    completeYourQuest: 'Schließen Sie Ihre STL Quest ab',
    readyForNext: 'Bereit für die nächste Quest',
    learnByDoing: 'Lernen durch Handeln',
    xp: (points) => `${points} XP`,
    progress: (resolved, total, points, totalPoints) =>
      `${resolved} von ${total} Quests erledigt · ${points} von ${totalPoints} XP erhalten`,
    summary: (completed, skipped) => `${completed} abgeschlossen · ${skipped} übersprungen`,
    reviewQuests: 'Quests ansehen',
    rowComplete: 'Erledigt',
    showResolved: (count: number) => `${count} erledigte anzeigen`,
    hideResolved: 'Erledigte ausblenden',
    rowSkipped: 'Übersprungen',
    rowPoints: (points, isNew) => `${isNew ? 'Neu · ' : ''}${points} XP`,
    restore: (title) => `${title} wiederherstellen`,
    skip: (title) => `${title} überspringen`,
    notForMe: 'Nichts für mich',
    promptLabel: 'STL Quest',
    promptHeading: (points) => `STL Quest · +${points} XP`,
    closePrompt: 'Einführungshinweis schließen',
  },
  onboarding: {
    sections: {
      'getting-started': 'Erste Schritte',
      optional: 'Optional',
    },
    quests: {
      printers: {
        title: 'Ihre Drucker hinzufügen',
        description:
          'Fügen Sie jeden Drucker hinzu, damit Drucke einem passenden Gerät zugeordnet werden und Angebote seine Betriebskosten nutzen.',
      },
      stock: {
        resin: {
          title: 'Ihre Harze hinzufügen',
          description: 'Optional. Fügen Sie die Harze hinzu, mit denen Sie drucken, und was Sie zahlen, damit Angebote Ihre Preise nutzen.',
        },
        filament: {
          title: 'Ihre Filamente hinzufügen',
          description:
            'Optional. Fügen Sie die Filamente hinzu, mit denen Sie drucken, und was Sie zahlen, damit Angebote Ihre Preise nutzen.',
        },
        both: {
          title: 'Ihre Materialien hinzufügen',
          description:
            'Optional. Fügen Sie die Harze und Filamente hinzu, mit denen Sie drucken, und was Sie zahlen, damit Angebote Ihre Preise nutzen.',
        },
      },
      upload: {
        title: 'Ihren ersten Druck hinzufügen',
        description: 'Laden Sie ein Modell hoch oder speichern Sie einen Link, um Aufträge in die Warteschlange zu stellen.',
      },
      move: {
        title: 'Einen Druck bis „Fertig“ bringen',
        description: 'Ziehen Sie eine Druckkarte aus der Warteschlange über „Im Druck“ und „Nachbearbeitung“ bis „Fertig“.',
      },
      inspect: {
        title: 'Einen Druck ansehen',
        description: 'Öffnen Sie eine Druckkarte, um Modell, Notizen, Kopien und Zuweisung zu prüfen.',
      },
      download: {
        title: 'Ein Modell herunterladen',
        description: 'Laden Sie eine STL-Datei über eine Druckkarte oder deren Detailansicht herunter.',
      },
      invite: {
        title: 'Ihr Team einladen',
        description: 'Erstellen Sie eine einmalige Einladung für eine anfragende Person oder einen weiteren Administrator.',
      },
      tracking: {
        title: 'Verbrauch und Bestand erfassen',
        description:
          'Optional. Geben Sie an, was jeder Druck verbraucht hat, und Bestände, Nachkäufe, Verschleiß und Ausgaben zählen sich selbst. Hier einschalten.',
      },
    },
  },
  confirm: {
    noDetail: 'Es wurden keine weiteren Details zurückgegeben.',
  },
  query: {
    requestFailed: 'Die Anfrage ist fehlgeschlagen. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
    retry: 'Erneut versuchen',
    mutationFailed: 'Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.',
    staleServerFunction: 'STL Quest wurde aktualisiert. Laden Sie die Seite neu, um fortzufahren.',
  },
  routeError: {
    body: 'Der Server konnte diese Seite nicht laden. Laden Sie die Seite neu, um es erneut zu versuchen, und prüfen Sie die Serverprotokolle, falls das Problem bestehen bleibt.',
    refresh: 'Neu laden',
  },
  release: {
    available: (version) => `STL Quest v${version} ist verfügbar.`,
    viewWhatsNew: 'Neuigkeiten ansehen',
    viewRelease: 'Release ansehen',
  },
  updates: {
    couldNotLoad: 'STL Quest konnte nicht vollständig geladen werden.',
    updated: 'STL Quest wurde aktualisiert.',
    refresh: 'Neu laden',
  },
  copyValue: (label) => `${label} kopieren`,
  datePicker: {
    clearDate: 'Datum löschen',
  },
  ui: {
    loading: 'Wird geladen',
    columns: 'Spalten',
    itemCount: (count, label) => `${count} ${label}`,
    perPage: (size) => `${size} pro Seite`,
    itemsPerPage: (items) => `${capitalize(items)} pro Seite`,
    pageOf: (page, total) => `Seite ${page} von ${total}`,
    previous: 'Zurück',
    next: 'Weiter',
  },
}
