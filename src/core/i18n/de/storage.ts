import type { storage as en } from '../en/storage'

function inventory(files: number, folders: number, size: string) {
  const parts = [`${files} ${files === 1 ? 'Datei' : 'Dateien'}`, ...(folders ? [`${folders} Ordner`] : [])]
  return `${parts.join(' und ')} (${size})`
}

const kindName = (kind: 'bucket' | 'folder') => (kind === 'bucket' ? 'Bucket' : 'Ordner')

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

export const storage: typeof en = {
  pane: {
    title: 'Speicher',
    loadingDescription:
      'Verschieben Sie fertige Druckdateien zwischen lokalen Ordnern, S3-kompatiblen Anbietern und verbundenem Cloud-Speicher.',
    description: (choices: string) =>
      `Verschieben Sie fertige Druckdateien in ${choices}. STL Quest kopiert und prüft jede Datei vor dem Wechsel und lässt die Quelle als Rückfallebene unverändert.`,
    choices: {
      managed: 'den inklusiven Speicher',
      local: 'einen lokalen Ordner',
      webdav: 'einen entfernten WebDAV-Ordner',
      s3: 'S3-kompatiblen Speicher',
      cloud: 'verbundenen Cloud-Speicher',
    },
    loading: 'Speichereinstellungen werden geladen…',
    loadError: 'Speichereinstellungen konnten nicht geladen werden',
    allOptions: 'Alle Speicheroptionen',
    target: {
      managed: 'den inklusiven Speicher',
      local: 'einen Ordner auf diesem Server',
      webdav: 'einen entfernten Ordner',
      s3: 'einen S3-kompatiblen Bucket',
    },
    setUpHeading: (target: string) => `${capitalize(target)} einrichten`,
    editHeading: (target: string) => `${capitalize(target)} bearbeiten`,
    switchHeading: (target: string) => `Auf ${target} wechseln`,
    formIntro:
      'Füllen Sie die folgenden Angaben aus und testen Sie dann die Verbindung, damit Fehler hier auffallen statt beim ersten Hochladen.',
    editCurrent: 'Aktuellen Speicher bearbeiten',
    managedTitle: (size: string) => `${size} inklusiver Speicher`,
    managedBody:
      'Von STL Quest gehostet und von Ihren Arbeitsbereichen gemeinsam genutzt. Modelle, Vorschauen, Miniaturansichten, optimierte Dateien und wiederherstellbarer Papierkorb zählen zu diesem Kontingent. Löschen Sie Dateien, um Platz freizugeben, oder wechseln Sie für eine größere Bibliothek zu eigenem Speicher.',
    folder: 'Ordner',
    browse: 'Durchsuchen',
    folderDescription:
      'Muss für den STL-Quest-Prozess beschreibbar sein, also meist ein eingebundenes Volume. Darunter wird ein privates Verzeichnis für den Arbeitsbereich angelegt.',
    testing: 'Wird getestet…',
    testConnection: 'Verbindung testen',
    checking: 'Speicher wird geprüft…',
    connectFirst: (provider: string) => `Zuerst ${provider} verbinden`,
    saveAndContinue: 'Speichern und fortfahren',
    save: 'Speicher speichern',
    migrationInProgress: 'Migration läuft',
    noChanges: 'Keine Speicheränderungen',
    verified: 'Verbindung bestätigt',
    verifiedOnboarding: 'Der Speicher ist erreichbar und beschreibbar. Als Nächstes folgen die Drucker, die Sie auch überspringen können.',
    untestedOnboarding:
      'Noch ist nichts hochgeladen. STL Quest schreibt eine temporäre Datei, um zu bestätigen, dass der Speicherort beschreibbar ist.',
    destination: { before: 'Modelle werden in einen privaten Arbeitsbereichsordner unterhalb von ', after: ' geschrieben.' },
  },
  notice: {
    notConnectedTitle: (provider: string) => `${provider} ist noch nicht verbunden`,
    notConnectedHint: 'Tragen Sie oben die App-Zugangsdaten ein und verbinden Sie das Konto, dann kann es als Speicher genutzt werden.',
    notChanged: 'Der Speicher wurde nicht geändert',
    unusableLocation: 'STL Quest konnte diesen Speicherort nicht verwenden',
    connectedTitle: (provider: string) => `${provider} ist verbunden`,
    connectedHint: 'Speichern Sie den Speicher, um den Ordner dieses Arbeitsbereichs anzulegen.',
    connectFailedTitle: (provider: string) => `${provider} konnte nicht verbunden werden`,
    connectFailedHint:
      'Prüfen Sie, ob Client-ID, Secret und Weiterleitungs-URI mit der App in der Konsole des Anbieters übereinstimmen, und verbinden Sie dann erneut.',
    openFailedTitle: (provider: string) => `${provider} konnte nicht geöffnet werden`,
    openFailedHint: 'Prüfen Sie Client-ID und Secret und versuchen Sie dann erneut, die Verbindung herzustellen.',
    disconnectFailedTitle: (provider: string) => `${provider} konnte nicht getrennt werden`,
    disconnectFailedHint: 'Versuchen Sie es gleich noch einmal.',
    retryFailedTitle: 'Der Umzug konnte nicht erneut gestartet werden',
    retryFailedHint: 'Der neue Speicherort ist möglicherweise nicht mehr erreichbar.',
    stopFailedTitle: 'Der Umzug konnte nicht angehalten werden',
    stopFailedHint: 'Der Umzug ist möglicherweise bereits abgeschlossen.',
  },
  recoveryHint: {
    managed:
      'Versuchen Sie es erneut oder wenden Sie sich an den Betreiber des gehosteten Dienstes, falls der inklusive Speicher weiterhin nicht verfügbar ist.',
    local:
      'Prüfen Sie, ob der Ordner auf dem Server existiert und STL Quest darin schreiben kann – meist ist das ein eingebundenes Volume.',
    webdav:
      'Prüfen Sie, ob die Adresse von diesem Server aus über HTTPS erreichbar ist und Benutzername und Passwort zu diesem Ordner gehören.',
    s3: 'Prüfen Sie Bucket-Name, Region und Schlüssel sowie, ob der Schlüssel Objekte im Bucket auflisten, lesen und schreiben darf.',
    cloud: 'Verbinden Sie das Konto unten erneut; die App hat möglicherweise Berechtigungen verloren, die STL Quest benötigt.',
  },
  cancelMigration: {
    abandonTitle: 'Fehlgeschlagene Migration verwerfen?',
    stopTitle: 'Verschieben der Dateien anhalten?',
    abandonDescription:
      'STL Quest löscht unvollständige Kopien im verwalteten Speicher und gibt das inklusive Kontingent frei. Ihr aktueller Speicher bleibt aktiv.',
    stopDescription:
      'STL Quest kopiert die aktuelle Datei fertig und hält dann an. Ihr aktueller Speicher bleibt aktiv, und bereits erstellte Kopien bleiben am neuen Speicherort.',
    abandonConfirm: 'Unvollständige Kopien löschen',
    stopConfirm: 'Umzug anhalten',
  },
  picker: {
    descriptionManagedInUse:
      'Nutzen Sie weiterhin den für Sie gehosteten Speicher oder wechseln Sie zu selbst verwaltetem Speicher. STL Quest kopiert und prüft Ihre Dateien vor dem Wechsel.',
    descriptionInUse:
      'Nutzen Sie weiterhin den aktiven Speicherort, bearbeiten Sie seine Verbindung oder wählen Sie einen neuen. STL Quest kopiert und prüft Ihre Dateien vor dem Wechsel.',
    descriptionUnused:
      'Es wurde noch nichts hochgeladen, ein Wechsel kostet jetzt also nichts. Wählen Sie einen anderen Speicherort oder behalten Sie den bereits eingerichteten.',
    descriptionServerFolder:
      'Uploads werden direkt in Ihren eigenen Speicher geschrieben, und STL Quest behält nie eine zweite Kopie. Verbinden Sie einen Speicherort, und das Board ist bereit für Drucke.',
    descriptionManaged: 'STL Quest kann Ihre Modelle für Sie hosten oder sich mit Speicher verbinden, den Sie bereits verwalten.',
    descriptionRemoteRequired: 'Gehostete Arbeitsbereiche benötigen entfernten Speicher, bevor das Board für Drucke bereit ist.',
    localLabel: 'Ein Ordner auf diesem Server',
    localRequires: (folder: string) => `Schreibt in einen Ordner auf dem Rechner, auf dem STL Quest läuft, etwa ${folder}.`,
    s3Label: 'S3-kompatibler Bucket',
    s3Requires: 'Benötigt einen Bucket und Zugriffsschlüssel von Amazon S3, Cloudflare R2, Backblaze, MinIO oder einem ähnlichen Anbieter.',
    webdavLabel: 'Entfernter Ordner über WebDAV',
    webdavRequires: 'Benötigt einen WebDAV-Server auf Ihrem eigenen Rechner oder NAS, der über HTTPS erreichbar ist.',
    changeTitle: 'Ändern, wo Ihre Modelle liegen',
    chooseTitle: 'Wählen, wo Ihre Modelle liegen',
    setUp: 'Speicher ist eingerichtet',
    inUse: 'In Verwendung',
    managedInUse: 'Von STL Quest gehostet. Der Speicher Ihres Kontos wird von allen Arbeitsbereichen gemeinsam genutzt, die ihn verwenden.',
    modelsGoTo: { before: 'Modelle werden in ', after: ' gespeichert.' },
    keepAndContinue: 'Beibehalten und fortfahren',
    serverDisk: 'Die eigene Festplatte dieses Servers',
    recommended: 'Empfohlen',
    serverDiskBody: { before: 'Modelle werden in ', after: ' geschrieben. Keine Registrierung, keine Schlüssel zum Kopieren.' },
    preparing: 'Speicher wird vorbereitet…',
    useFolder: 'Diesen Ordner verwenden',
    pickAnother: 'Anderen Ordner wählen',
    included: 'Inklusiver Speicher',
    includedSettings:
      'Von STL Quest gehostet. Der Speicher Ihres Kontos wird von allen Arbeitsbereichen gemeinsam genutzt, die ihn verwenden. Sonst ist nichts zu konfigurieren.',
    useIncluded: 'Inklusiven Speicher verwenden',
    connectInstead: 'Verbinden Sie stattdessen S3, WebDAV oder ein Cloud-Konto für diesen Arbeitsbereich.',
    ownInstead: 'Stattdessen eigenen Speicher verwenden',
    switchElse: 'Zu etwas anderem wechseln',
    orOwn: 'Oder eigenen Speicher verwenden',
    orConnect: 'Oder bereits genutzten Speicher verbinden',
    connect: 'Bereits genutzten Speicher verbinden',
    consumerCloud: 'Cloud-Speicher für Privatkunden',
    cloudReady: 'Melden Sie sich mit Ihrem eigenen Konto an. Modelle landen in Ihrem Speicher, nicht in einem gemeinsamen.',
    cloudSetUp:
      'Jeder Anbieter erfordert eine einmalige Einrichtung für diese Installation, danach kann jeder Arbeitsbereich sein eigenes Konto verbinden.',
    cloudNeedsApp:
      'Für jeden Anbieter muss zuerst eine eigene App in einer Entwicklerkonsole angelegt werden, bevor STL Quest sich verbinden kann.',
    footer:
      'Der Speicher kann später in den Einstellungen umziehen. STL Quest kopiert und prüft jede Datei vor dem Wechsel und lässt das Original unverändert.',
  },
  label: {
    managed: 'Inklusiver Speicher',
    local: 'Lokaler Speicher',
  },
  s3: {
    provider: 'Anbieter',
    providers: {
      aws: 'Amazon S3',
      backblaze: 'Backblaze B2',
      cloudflare: 'Cloudflare R2',
      digitalocean: 'DigitalOcean Spaces',
      'google-cloud': 'Google Cloud Storage',
      custom: 'Benutzerdefiniert, S3-kompatibel',
    },
    help: {
      aws: {
        description: 'Verwenden Sie einen IAM-Zugriffsschlüssel mit Lese- und Schreibrechten für den ausgewählten Bucket.',
        accessKey: 'Zugriffsschlüssel-ID',
        secretKey: 'Geheimer Zugriffsschlüssel',
      },
      backblaze: {
        description: 'Erstellen Sie einen Anwendungsschlüssel für den Bucket und kopieren Sie die Region seines S3-Endpunkts.',
        accessKey: 'Anwendungsschlüssel-ID',
        secretKey: 'Anwendungsschlüssel',
      },
      cloudflare: {
        description: 'Erstellen Sie ein R2-API-Token mit der Berechtigung „Object Read & Write“ und kopieren Sie Ihre Konto-ID.',
        accessKey: 'Zugriffsschlüssel-ID',
        secretKey: 'Geheimer Zugriffsschlüssel',
      },
      digitalocean: {
        description: 'Erstellen Sie einen Spaces-Zugriffsschlüssel und wählen Sie die Rechenzentrumsregion, in der Ihr Space liegt.',
        accessKey: 'Spaces-Zugriffsschlüssel',
        secretKey: 'Geheimer Spaces-Schlüssel',
      },
      'google-cloud': {
        description: 'Erstellen Sie einen HMAC-Schlüssel für ein Dienstkonto mit Zugriff auf den ausgewählten Bucket.',
        accessKey: 'HMAC-Zugriffs-ID',
        secretKey: 'HMAC-Secret',
      },
      custom: {
        description:
          'Verwenden Sie den Endpunkt und die Zugangsdaten von MinIO, Wasabi, Ihrem NAS oder einem anderen S3-kompatiblen Dienst.',
        accessKey: 'Zugriffsschlüssel-ID',
        secretKey: 'Geheimer Zugriffsschlüssel',
      },
    },
    setupGuide: 'Einrichtungsanleitung öffnen',
    accountId: 'Cloudflare-Konto-ID',
    endpoint: 'S3-Endpunkt',
    bucket: 'Bucket',
    bucketName: 'Name',
    region: 'Region',
    regionDescription: 'Muss mit der Region des Buckets übereinstimmen.',
    prefix: 'Schlüsselpräfix (optional)',
    prefixDescription: 'Hält STL Quest unterhalb eines Pfads, sodass der Bucket auch andere Daten enthalten kann.',
    accessKeys: 'Zugriffsschlüssel',
    accessKeysDescription:
      'Erstellen Sie einen auf diesen Bucket beschränkten Schlüssel, statt einen kontoweiten Schlüssel wiederzuverwenden.',
    keepSecret: 'leer lassen, um den aktuellen beizubehalten',
    pathStyle: 'Pfadbasierte Anfragen',
    pathStyleDescription: 'Erforderlich für MinIO und die meisten selbst gehosteten S3-Endpunkte.',
  },
  webdav: {
    introTitle: 'Ein normaler Ordner auf Hardware, die Sie kontrollieren',
    intro:
      'Betreiben Sie einen WebDAV-Server für den Ordner und stellen Sie ihn über eine feste HTTPS-Adresse bereit. Cloudflare Tunnel oder Tailscale Funnel können die verschlüsselte Verbindung herstellen, ohne einen Port am Router zu öffnen. Die Dateien bleiben auf Ihrem Rechner sichtbar und verschiebbar.',
    setupLink: 'Entferntes WebDAV einrichten',
    endpoint: 'WebDAV-Endpunkt',
    endpointDescription: 'Gehostetes STL Quest erfordert HTTPS und muss diese Adresse erreichen können.',
    folder: 'Ordner',
    folderDescription: 'STL Quest legt unterhalb dieses Ordners ein privates Verzeichnis für den Arbeitsbereich an.',
    credentials: 'Zugangsdaten',
    credentialsDescription: 'Verwenden Sie eine eigene Anmeldung für STL Quest statt des Kontos, mit dem der Server verwaltet wird.',
    username: 'Benutzername',
    password: 'Passwort',
    keepPassword: 'leer lassen, um das aktuelle beizubehalten',
  },
  cloud: {
    provider: 'Cloud-Anbieter',
    connectProvider: (provider: string) => `${provider} verbinden`,
    connected: 'Verbunden',
    signedIn: (accountName?: string) => `Angemeldet${accountName ? ` als ${accountName}` : ''}`,
    available: (provider: string) =>
      `Melden Sie sich unten an, und STL Quest schreibt die Modelle dieses Arbeitsbereichs in Ihr eigenes ${provider}.`,
    needsSetup: (provider: string) =>
      `${provider} erfordert eine einmalige Einrichtung für diese Installation. Einmal erledigt, kann jeder Arbeitsbereich, auch dieser, sein eigenes Konto verbinden.`,
    needsAdmin: (provider: string) =>
      `Ein Administrator muss ${provider} für diese Installation einrichten, bevor es verbunden werden kann.`,
    missingPermissionsTitle: (provider: string) => `${provider} hat nicht den Zugriff gewährt, den STL Quest benötigt`,
    missingPermissions: (provider: string) =>
      `Der ${provider}-App dieser Installation fehlen Berechtigungen. Ein Administrator muss sie unter Integrationen aktualisieren, danach können Sie erneut verbinden.`,
    setUpApp: (provider: string) => `${provider}-App einrichten`,
    opening: (provider: string) => `${provider} wird geöffnet…`,
    connectMine: (provider: string) => `Mein ${provider} verbinden`,
    reconnectMine: (provider: string) => `Mein ${provider} erneut verbinden`,
    disconnecting: 'Wird getrennt…',
    disconnect: 'Trennen',
  },
  cloudHelp: {
    dropbox: {
      credentials:
        'Erstellen Sie eine App mit eingeschränktem Zugriff vom Typ „App folder“ und fügen Sie dann die unten stehende Weiterleitungs-URI hinzu.',
      intro: 'Dropbox speichert Dateien in einem eigenen App-Ordner.',
      permissions: 'Aktivieren Sie account_info.read, files.metadata.read, files.content.read und files.content.write.',
      clientId: 'App key',
      secret: 'App secret',
    },
    'google-drive': {
      credentials: 'Aktivieren Sie die Google Drive API und erstellen Sie einen OAuth-Client für eine Webanwendung.',
      intro:
        'Google Drive speichert diesen Arbeitsbereich in einem Ordner, den STL Quest mit der eingeschränkten Berechtigung drive.file anlegt.',
      permissions: 'Fügen Sie die unten stehende Weiterleitungs-URI zu den autorisierten Weiterleitungs-URIs des OAuth-Clients hinzu.',
      clientId: 'Client-ID',
      secret: 'Clientschlüssel',
    },
    onedrive: {
      credentials:
        'Registrieren Sie eine Anwendung, wählen Sie „Any Entra ID Tenant + Personal Microsoft accounts“, wählen Sie dann unter „Redirect URI“ die Option „Web“ und fügen Sie die unten angezeigte OAuth-Weiterleitungs-URI ein.',
      intro: 'OneDrive speichert Dateien im eigenen Apps-Ordner der Anwendung.',
      permissions:
        'Kopieren Sie nach der Registrierung die Application (client) ID, erstellen Sie einen geheimen Clientschlüssel und fügen Sie delegierte Microsoft-Graph-Berechtigungen für User.Read, Files.ReadWrite und offline_access hinzu.',
      clientId: 'Client-ID',
      secret: 'Geheimer Clientschlüssel',
    },
    box: {
      credentials: 'Erstellen Sie eine Custom App mit OAuth 2.0 und fügen Sie dann die unten stehende Weiterleitungs-URI hinzu.',
      intro: 'Box speichert diesen Arbeitsbereich in einem Ordner, den STL Quest anlegt.',
      permissions: 'Aktivieren Sie „Read and write all files and folders stored in Box“ und übermitteln Sie dann die App-Konfiguration.',
      clientId: 'Client-ID',
      secret: 'Geheimer Clientschlüssel',
    },
  },
  appDialog: {
    openConsole: (provider: string) => `${provider}-Entwicklerkonsole öffnen`,
    copyCredentials:
      'Kopieren Sie die unten stehenden Zugangsdaten. Danach verbindet jeder Arbeitsbereich sein eigenes Konto unter Einstellungen → Speicher.',
    redirectUri: 'OAuth-Weiterleitungs-URI',
    credentials: 'App-Zugangsdaten',
    keepSecret: 'Leer lassen, um das aktuelle Secret beizubehalten',
    notSavedTitle: (provider: string) => `${provider} wurde nicht gespeichert`,
    notSavedHint: (provider: string) => `Prüfen Sie, ob die Zugangsdaten mit der App in der ${provider}-Konsole übereinstimmen.`,
    remove: 'App entfernen',
  },
  integrations: {
    title: 'Cloud-Speicher',
    description:
      'Registrieren Sie eine App pro Anbieter, damit jeder Arbeitsbereich sein eigenes Konto verbinden kann. Jeder Eigentümer eines Arbeitsbereichs meldet sich selbst an, und seine Modelle bleiben in seinem eigenen Konto.',
    enabled: 'Für Arbeitsbereiche verfügbar',
    disabled: 'Deaktiviert',
    notSetUp: 'Nicht eingerichtet',
    enable: (provider: string) => `${provider} aktivieren`,
    disable: (provider: string) => `${provider} deaktivieren`,
    editApp: 'App bearbeiten',
    setUpApp: 'App einrichten',
  },
  change: {
    notEmptyTitle: (kind) => `Dieser ${kindName(kind)} ist nicht leer`,
    moveTitle: 'Ihre Dateien an den neuen Speicherort verschieben?',
    occupiedDescription: (files: number, folders: number, size: string) =>
      `${inventory(files, folders, size)} ${files + folders === 1 ? 'liegt' : 'liegen'} bereits dort. Legen Sie fest, was damit geschieht, bevor STL Quest den Speicherort verwendet.`,
    moveDescription: 'STL Quest kopiert und prüft jede Datei am neuen Speicherort, bevor er aktiv wird.',
    from: 'Von',
    to: 'Nach',
    seeContents: 'Anzeigen, was bereits dort liegt',
    truncated: 'Die ersten 100 Einträge werden angezeigt.',
    preserveTitle: 'Unverändert lassen',
    preserveDescription: (kind) =>
      `STL Quest legt seinen eigenen Arbeitsbereichsordner neben den vorhandenen Inhalt in diesem ${kindName(kind)}. Nichts Vorhandenes wird gelesen, verschoben oder gelöscht.`,
    clearTitle: 'Zuerst alles dort löschen',
    clearDescription: (files: number, folders: number, size: string) =>
      `Entfernt dauerhaft ${inventory(files, folders, size)}, einschließlich Dateien anderer STL-Quest-Arbeitsbereiche. Dies kann nicht rückgängig gemacht werden.`,
    acknowledge: (kind) => `Mir ist bewusst, dass alles, was sich derzeit in diesem ${kindName(kind)} befindet, endgültig gelöscht wird.`,
    migrationNote:
      'Ihr aktueller Speicher versorgt das Board weiter, bis Kopieren und Prüfen abgeschlossen sind, sodass nichts verloren geht, falls der Umzug fehlschlägt.',
    immediateNote: 'Der neue Speicherort wird verwendet, sobald Sie bestätigen.',
    deleteAndSwitch: 'Löschen und wechseln',
    copyAndSwitch: 'Dateien kopieren und wechseln',
    startUsing: 'Jetzt verwenden',
  },
  migration: {
    starting: 'Migration wird gestartet…',
    preparing: 'Das Ziel wird geprüft und vorbereitet. Der aktuelle Speicher bleibt aktiv.',
    cancelling: 'Migration wird abgebrochen…',
    running: 'Speicher wird migriert',
    completed: 'Migration abgeschlossen',
    cancelled: 'Migration abgebrochen',
    failed: 'Migration fehlgeschlagen',
    finishingStep: 'Aktueller Schritt wird abgeschlossen',
    clearing: 'Inhalt des Ziels wird gelöscht',
    copying: 'Dateien werden kopiert und geprüft',
    progressLabel: 'Fortschritt der Speichermigration',
    progress: (copiedFiles: number, totalFiles: number, copiedSize: string, totalSize: string | undefined) =>
      `${copiedFiles} von ${totalFiles || '…'} Dateien · ${copiedSize} von ${totalSize ?? 'wird berechnet…'}`,
    copyingFile: (name: string) => `${name} wird kopiert`,
    stopping: 'Die aktuelle Datei wird noch fertig kopiert, bevor angehalten wird. Der ursprüngliche Speicher bleibt aktiv.',
    originalActive: 'Der ursprüngliche Speicher bleibt aktiv, bis die Prüfung abgeschlossen ist.',
    requesting: 'Wird angefordert…',
    cancel: 'Migration abbrechen',
    retrying: 'Wird erneut versucht…',
    retry: 'Migration wiederholen',
    cleaningUp: 'Wird aufgeräumt…',
    abandon: 'Migration verwerfen',
  },
  usage: {
    label: 'Nutzung des verwalteten Speichers',
    usedOrReserved: (size: string) => `${size} belegt oder reserviert`,
    available: (size: string) => `${size} verfügbar`,
  },
  upgrade: {
    askAdmin: 'Bitten Sie einen Administrator des Arbeitsbereichs, den Tarif für mehr Speicher zu erweitern.',
    label: (plan: string, size: string) => `Auf ${plan} upgraden für ${size} Speicher`,
    action: (plan: string) => `Auf ${plan} upgraden`,
  },
  folderPicker: {
    title: 'Serverordner wählen',
    description:
      'Dies sind die Ordner, die im STL-Quest-Server oder -Container sichtbar sind. Ordner des Hosts müssen eingebunden sein, damit sie hier erscheinen.',
    root: 'Dateisystem des Servers',
    tree: 'Serverordner',
    unreadable: (path: string) => `${path} konnte nicht gelesen werden.`,
    problemTitle: 'Dieser Ordner konnte nicht geöffnet werden',
    problemHint: 'Der Server hat möglicherweise keine Leseberechtigung, oder der Ordner ist nicht in den Container eingebunden.',
    select: 'Ordner auswählen',
  },
  migrationFailures: {
    quota: (path, size) =>
      `Der verwaltete Speicher hat ${path} (${size}) abgelehnt, weil das Kopieren Ihr Speicherkontingent überschreiten würde. Geben Sie Speicher frei oder erhöhen Sie das Kontingent und wiederholen Sie dann die Migration.`,
    cloudflareUploadLimit: (path, size) =>
      `Cloudflare hat ${path} (${size}) abgelehnt, weil die Datei das Upload-Limit des Tarifs überschreitet. Stellen Sie den WebDAV-Endpunkt anhand der WebDAV-Einrichtungsanleitung auf Tailscale Funnel um und wiederholen Sie dann die Migration.`,
    webdavUploadLimit: (path, size) =>
      `WebDAV hat ${path} (${size}) abgelehnt, weil die Datei das Upload-Limit des Servers oder Proxys überschreitet. Erhöhen Sie das Limit oder verwenden Sie einen direkten Endpunkt wie Tailscale Funnel und wiederholen Sie dann die Migration.`,
  },
  problems: {
    unreadable: 'Ordner ist nicht lesbar',
    notAFolder: 'Pfad ist kein Ordner',
    missing: 'Ordner existiert nicht',
    unusable: (detail: string) => `Speicher ist nicht erreichbar oder nicht beschreibbar: ${detail}`,
    uninspectable: (detail: string) => `Speicher ist beschreibbar, aber sein Inhalt kann nicht geprüft werden: ${detail}`,
  },
  errors: {
    missingWebdavPassword: 'WebDAV-Passwort fehlt',
    invalidWebdavFolder: 'ungültiger WebDAV-Ordner',
    missingSecretAccessKey: 'geheimer Zugriffsschlüssel fehlt',
    invalidPrefix: 'ungültiges Präfix',
    managedUnavailable: 'verwalteter Speicher ist in dieser Installation nicht verfügbar',
    localUnavailable: 'lokaler Speicher ist in diesem Bereitstellungsmodus nicht verfügbar',
    webdavHttps: 'gehosteter WebDAV-Speicher muss HTTPS verwenden',
    endpointRejected: (reason: string) => `Speicher-Endpunkt abgelehnt: ${reason}`,
    endpointNotAllowed: 'Speicher-Endpunkt ist nicht zulässig',
    cloudAppMissing: (provider: string) => `${provider} ist für diese Installation nicht eingerichtet`,
    migrationInProgress: 'eine Speichermigration läuft bereits',
    assetsPaused: 'eine Speichermigration läuft; Dateiänderungen sind vorübergehend pausiert',
    sameDestination: 'wählen Sie einen anderen Speicherort',
    noFailedMigration: 'es gibt keine fehlgeschlagene Speichermigration, die wiederholt werden könnte',
    failedMigrationChanged: 'die fehlgeschlagene Speichermigration hat sich geändert; laden Sie neu und versuchen Sie es erneut',
    noRunningMigration: 'es gibt keine laufende Speichermigration, die abgebrochen werden könnte',
    operationsActive: 'warten Sie, bis laufende Dateioperationen und Uploads abgeschlossen sind, bevor Sie den Speicher migrieren',
    migrationElsewhere: 'eine Speichermigration läuft bereits auf einem anderen Replikat',
  },
}
