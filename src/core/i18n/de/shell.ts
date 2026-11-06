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
    rowComplete: 'Abgeschlossen · Ansehen',
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
      'managing-queue': 'Die Warteschlange verwalten',
      'workspace-setup': 'Ihren Arbeitsbereich konfigurieren',
    },
    quests: {
      upload: {
        title: 'Ihren ersten Druck hinzufügen',
        description:
          'Laden Sie ein Modell hoch oder speichern Sie einen Quelllink, sobald Sie Aufträge in die Warteschlange stellen möchten.',
      },
      move: {
        title: 'Aufträge durch die Warteschlange bewegen',
        description: 'Ziehen Sie eine Druckkarte zwischen Spalten, um ihre Phase zu ändern.',
      },
      inspect: {
        title: 'Einen Druck ansehen',
        description: 'Öffnen Sie eine Druckkarte, um Modell, Notizen, Kopien und Zuweisung zu prüfen.',
      },
      download: {
        title: 'Ein Modell herunterladen',
        description: 'Laden Sie eine STL-Datei über eine Druckkarte oder deren Detailansicht herunter.',
      },
      actions: {
        title: 'Druckaktionen entdecken',
        description: 'Verwenden Sie eine Aktion einer Druckkarte, um Aufträge auszuwählen, zu gruppieren, zu verschieben oder zu löschen.',
      },
      sort: {
        title: 'Ansicht der Warteschlange wählen',
        description: 'Sortieren Sie nach Priorität der anfragenden Person, Einreichungszeit, Name oder letzter Aktivität.',
      },
      filter: {
        title: 'Aufträge mit Filtern finden',
        description:
          'Wenden Sie einen Filter an, um die Warteschlange nach Druckart, anfragender Person, Datum, Dateien oder einem anderen nützlichen Feld einzugrenzen.',
      },
      printers: {
        title: 'Ihren Druckerpark zusammenstellen',
        description: 'Fügen Sie ein Druckerprofil hinzu und speichern Sie es, damit Anfragen kompatiblen Geräten zugeordnet werden können.',
      },
      storage: {
        title: 'Modellspeicher ansehen',
        description: 'Prüfen Sie den aktiven Speicheranbieter und die Möglichkeiten, Modelle später zu verschieben.',
      },
      visibility: {
        title: 'Sichtbarkeit der Anfragen wählen',
        description: 'Legen Sie fest, ob Anfragende die gemeinsame Warteschlange oder nur ihre eigenen Aufträge sehen.',
      },
      invite: {
        title: 'Eine Person aus dem Team einladen',
        description: 'Erstellen Sie eine einmalige Einladung für eine anfragende Person oder einen weiteren Administrator.',
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
