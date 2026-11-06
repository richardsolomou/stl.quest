import type { storage as en } from '../en/storage'

function inventory(files: number, folders: number, size: string) {
  const parts = [`${files} fichier${files <= 1 ? '' : 's'}`, ...(folders ? [`${folders} dossier${folders <= 1 ? '' : 's'}`] : [])]
  return `${parts.join(' et ')} (${size})`
}

const kindPhrase = (kind: 'bucket' | 'folder') => (kind === 'bucket' ? 'ce bucket' : 'ce dossier')

export const storage: typeof en = {
  pane: {
    title: 'Stockage',
    loadingDescription:
      'Déplacez les fichiers d’impression terminés entre des dossiers locaux, des fournisseurs compatibles S3 et un stockage cloud connecté.',
    description: (choices: string) =>
      `Déplacez les fichiers d’impression terminés entre ${choices}. STL Quest copie et vérifie chaque fichier avant de basculer, et laisse la source intacte en solution de repli.`,
    choices: {
      managed: 'le stockage inclus',
      local: 'un dossier local',
      webdav: 'un dossier WebDAV distant',
      s3: 'un stockage compatible S3',
      cloud: 'un stockage cloud connecté',
    },
    loading: 'Chargement des paramètres de stockage…',
    loadError: 'Impossible de charger les paramètres de stockage',
    allOptions: 'Toutes les options de stockage',
    target: {
      managed: 'le stockage inclus',
      local: 'un dossier sur ce serveur',
      webdav: 'un dossier distant',
      s3: 'un bucket compatible S3',
    },
    setUpHeading: (target: string) => `Configurer ${target}`,
    editHeading: (target: string) => `Modifier ${target}`,
    switchHeading: (target: string) => `Passer à ${target}`,
    formIntro:
      'Renseignez les informations ci-dessous, puis testez la connexion pour que les erreurs apparaissent ici plutôt qu’à votre premier téléversement.',
    editCurrent: 'Modifier le stockage actuel',
    managedTitle: (size: string) => `${size} de stockage inclus`,
    managedBody:
      'Hébergé par STL Quest et partagé entre vos espaces de travail. Les modèles, aperçus, miniatures, fichiers optimisés et la corbeille récupérable sont décomptés de ce quota. Supprimez des fichiers pour libérer de l’espace, ou passez à un stockage qui vous appartient pour une bibliothèque plus grande.',
    folder: 'Dossier',
    browse: 'Parcourir',
    folderDescription:
      'Le processus STL Quest doit pouvoir y écrire, il s’agit donc généralement d’un volume monté. Un répertoire privé pour l’espace de travail est créé à l’intérieur.',
    testing: 'Test en cours…',
    testConnection: 'Tester la connexion',
    checking: 'Vérification du stockage…',
    connectFirst: (provider: string) => `Connectez d’abord ${provider}`,
    saveAndContinue: 'Enregistrer et continuer',
    save: 'Enregistrer le stockage',
    migrationInProgress: 'Migration en cours',
    noChanges: 'Aucune modification du stockage',
    verified: 'Connexion vérifiée',
    verifiedOnboarding:
      'Le stockage est joignable et accessible en écriture. Les imprimantes viennent ensuite, et vous pouvez passer cette étape.',
    untestedOnboarding:
      'Rien n’est encore téléversé. STL Quest écrit un fichier temporaire pour confirmer que l’emplacement est accessible en écriture.',
    destination: { before: 'Les modèles seront écrits dans un dossier privé de l’espace de travail sous ', after: '.' },
  },
  notice: {
    notConnectedTitle: (provider: string) => `${provider} n’est pas encore connecté`,
    notConnectedHint: 'Ajoutez les identifiants de l’application ci-dessus et connectez le compte pour pouvoir l’utiliser comme stockage.',
    notChanged: 'Le stockage n’a pas été modifié',
    unusableLocation: 'STL Quest n’a pas pu utiliser cet emplacement',
    connectedTitle: (provider: string) => `${provider} est connecté`,
    connectedHint: 'Enregistrez le stockage pour créer le dossier de cet espace de travail.',
    connectFailedTitle: (provider: string) => `${provider} n’a pas pu être connecté`,
    connectFailedHint:
      'Vérifiez que l’ID client, le secret et l’URI de redirection correspondent à l’application dans la console du fournisseur, puis reconnectez-vous.',
    openFailedTitle: (provider: string) => `Impossible d’ouvrir ${provider}`,
    openFailedHint: 'Vérifiez l’ID client et le secret, puis réessayez de vous connecter.',
    disconnectFailedTitle: (provider: string) => `Impossible de déconnecter ${provider}`,
    disconnectFailedHint: 'Réessayez dans un instant.',
    retryFailedTitle: 'Impossible de relancer le déplacement',
    retryFailedHint: 'Le nouvel emplacement est peut-être devenu injoignable.',
    stopFailedTitle: 'Impossible d’arrêter le déplacement',
    stopFailedHint: 'Le déplacement est peut-être déjà terminé.',
  },
  recoveryHint: {
    managed: 'Réessayez, ou contactez l’opérateur du service hébergé si le stockage inclus reste indisponible.',
    local: 'Vérifiez que le dossier existe sur le serveur et que STL Quest peut y écrire, il s’agit généralement d’un volume monté.',
    webdav:
      'Vérifiez que l’adresse est joignable en HTTPS depuis ce serveur, et que le nom d’utilisateur et le mot de passe correspondent à ce dossier.',
    s3: 'Vérifiez le nom du bucket, la région et les clés, et que la clé peut lister, lire et écrire des objets dans le bucket.',
    cloud: 'Reconnectez le compte ci-dessous : l’application a peut-être perdu les autorisations dont STL Quest a besoin.',
  },
  cancelMigration: {
    abandonTitle: 'Abandonner la migration échouée ?',
    stopTitle: 'Arrêter le déplacement des fichiers ?',
    abandonDescription:
      'STL Quest supprime les copies partielles du stockage géré et libère le quota inclus. Votre stockage actuel reste actif.',
    stopDescription:
      'STL Quest termine le fichier en cours de copie, puis s’arrête. Votre stockage actuel reste actif, et les copies déjà faites restent dans le nouvel emplacement.',
    abandonConfirm: 'Supprimer les copies partielles',
    stopConfirm: 'Arrêter le déplacement',
  },
  picker: {
    descriptionManagedInUse:
      'Continuez avec le stockage hébergé pour vous, ou passez à un stockage que vous gérez. STL Quest copie et vérifie vos fichiers avant de basculer.',
    descriptionInUse:
      'Continuez avec l’emplacement actif, modifiez sa connexion ou choisissez-en un nouveau. STL Quest copie et vérifie vos fichiers avant de basculer.',
    descriptionUnused:
      'Rien n’a encore été téléversé, changer maintenant ne coûte donc rien. Choisissez un autre emplacement, ou gardez celui que vous avez déjà configuré.',
    descriptionServerFolder:
      'Les téléversements sont écrits directement dans un stockage qui vous appartient, et STL Quest n’en garde jamais de seconde copie. Connectez un emplacement et le tableau est prêt pour les impressions.',
    descriptionManaged: 'STL Quest peut héberger vos modèles pour vous, ou se connecter à un stockage que vous gérez déjà.',
    descriptionRemoteRequired:
      'Les espaces de travail hébergés nécessitent un stockage distant avant que le tableau soit prêt pour les impressions.',
    localLabel: 'Un dossier sur ce serveur',
    localRequires: (folder: string) => `Écrit dans un dossier de la machine qui exécute STL Quest, par exemple ${folder}.`,
    s3Label: 'Bucket compatible S3',
    s3Requires: 'Nécessite un bucket et des clés d’accès d’Amazon S3, Cloudflare R2, Backblaze, MinIO ou d’un fournisseur similaire.',
    webdavLabel: 'Dossier distant via WebDAV',
    webdavRequires: 'Nécessite un serveur WebDAV sur votre propre machine ou NAS, joignable en HTTPS.',
    changeTitle: 'Changer l’emplacement de vos modèles',
    chooseTitle: 'Choisir l’emplacement de vos modèles',
    setUp: 'Le stockage est configuré',
    inUse: 'Utilisé',
    managedInUse: 'Hébergé par STL Quest. Le stockage de votre compte est partagé entre tous les espaces de travail qui l’utilisent.',
    modelsGoTo: { before: 'Les modèles sont enregistrés dans ', after: '.' },
    keepAndContinue: 'Garder celui-ci et continuer',
    serverDisk: 'Le disque de ce serveur',
    recommended: 'Recommandé',
    serverDiskBody: { before: 'Les modèles sont écrits dans ', after: '. Aucune inscription, aucune clé à copier.' },
    preparing: 'Préparation du stockage…',
    useFolder: 'Utiliser ce dossier',
    pickAnother: 'Choisir un autre dossier',
    included: 'Stockage inclus',
    includedSettings:
      'Hébergé par STL Quest. Le stockage de votre compte est partagé entre tous les espaces de travail qui l’utilisent. Rien d’autre à configurer.',
    useIncluded: 'Utiliser le stockage inclus',
    connectInstead: 'Connectez plutôt S3, WebDAV ou un compte cloud pour cet espace de travail.',
    ownInstead: 'Utiliser plutôt votre propre stockage',
    switchElse: 'Passer à autre chose',
    orOwn: 'Ou utilisez votre propre stockage',
    orConnect: 'Ou connectez un stockage que vous utilisez déjà',
    connect: 'Connectez un stockage que vous utilisez déjà',
    consumerCloud: 'Stockage cloud grand public',
    cloudReady: 'Connectez-vous avec votre propre compte. Les modèles vont dans votre stockage, pas dans un stockage partagé.',
    cloudSetUp:
      'Chaque fournisseur nécessite une configuration unique pour ce déploiement, puis chaque espace de travail peut connecter son propre compte.',
    cloudNeedsApp:
      'Chaque fournisseur nécessite sa propre application créée dans une console développeur avant que STL Quest puisse s’y connecter.',
    footer:
      'Le stockage peut être déplacé plus tard depuis les paramètres. STL Quest copie et vérifie chaque fichier avant de basculer, et laisse l’original intact.',
  },
  label: {
    managed: 'Stockage inclus',
    local: 'Stockage local',
  },
  s3: {
    provider: 'Fournisseur',
    providers: {
      aws: 'Amazon S3',
      backblaze: 'Backblaze B2',
      cloudflare: 'Cloudflare R2',
      digitalocean: 'DigitalOcean Spaces',
      'google-cloud': 'Google Cloud Storage',
      custom: 'Compatible S3 personnalisé',
    },
    help: {
      aws: {
        description: 'Utilisez une clé d’accès IAM autorisée à lire et écrire dans le bucket choisi.',
        accessKey: 'ID de clé d’accès',
        secretKey: 'Clé d’accès secrète',
      },
      backblaze: {
        description: 'Créez une clé d’application pour le bucket et copiez la région de son point de terminaison S3.',
        accessKey: 'ID de clé d’application',
        secretKey: 'Clé d’application',
      },
      cloudflare: {
        description: 'Créez un jeton d’API R2 avec l’autorisation Object Read & Write et copiez l’ID de votre compte.',
        accessKey: 'ID de clé d’accès',
        secretKey: 'Clé d’accès secrète',
      },
      digitalocean: {
        description: 'Créez une clé d’accès Spaces et choisissez la région du centre de données qui contient votre Space.',
        accessKey: 'Clé d’accès Spaces',
        secretKey: 'Clé secrète Spaces',
      },
      'google-cloud': {
        description: 'Créez une clé HMAC pour un compte de service ayant accès au bucket choisi.',
        accessKey: 'ID d’accès HMAC',
        secretKey: 'Secret HMAC',
      },
      custom: {
        description:
          'Utilisez le point de terminaison et les identifiants fournis par MinIO, Wasabi, votre NAS ou un autre service compatible S3.',
        accessKey: 'ID de clé d’accès',
        secretKey: 'Clé d’accès secrète',
      },
    },
    setupGuide: 'Ouvrir le guide de configuration',
    accountId: 'ID de compte Cloudflare',
    endpoint: 'Point de terminaison S3',
    bucket: 'Bucket',
    bucketName: 'Nom',
    region: 'Région',
    regionDescription: 'Doit correspondre à la région du bucket.',
    prefix: 'Préfixe de clé (facultatif)',
    prefixDescription: 'Garde STL Quest sous un seul chemin pour que le bucket puisse contenir d’autres données.',
    accessKeys: 'Clés d’accès',
    accessKeysDescription: 'Créez une clé limitée à ce bucket plutôt que de réutiliser une clé valable pour tout le compte.',
    keepSecret: 'laisser vide pour conserver l’actuelle',
    pathStyle: 'Requêtes de style chemin',
    pathStyleDescription: 'Requis par MinIO et la plupart des points de terminaison S3 auto-hébergés.',
  },
  webdav: {
    introTitle: 'Un dossier ordinaire sur du matériel que vous contrôlez',
    intro:
      'Exécutez un serveur WebDAV pour le dossier, puis exposez-le via une adresse HTTPS stable. Cloudflare Tunnel ou Tailscale Funnel peuvent fournir la connexion chiffrée sans ouvrir de port sur le routeur. Les fichiers restent visibles et déplaçables sur votre machine.',
    setupLink: 'Configurer WebDAV distant',
    endpoint: 'Point de terminaison WebDAV',
    endpointDescription: 'STL Quest hébergé exige HTTPS et doit pouvoir joindre cette adresse.',
    folder: 'Dossier',
    folderDescription: 'STL Quest ajoute un répertoire privé pour l’espace de travail sous ce dossier.',
    credentials: 'Identifiants',
    credentialsDescription: 'Utilisez un identifiant dédié à STL Quest plutôt que le compte qui administre le serveur.',
    username: 'Nom d’utilisateur',
    password: 'Mot de passe',
    keepPassword: 'laisser vide pour conserver l’actuel',
  },
  cloud: {
    provider: 'Fournisseur cloud',
    connectProvider: (provider: string) => `Connecter ${provider}`,
    connected: 'Connecté',
    signedIn: (accountName?: string) => `Connecté${accountName ? ` en tant que ${accountName}` : ''}`,
    available: (provider: string) =>
      `Connectez-vous ci-dessous et STL Quest écrit les modèles de cet espace de travail dans votre propre ${provider}.`,
    needsSetup: (provider: string) =>
      `${provider} nécessite une configuration unique pour ce déploiement. Une fois faite, chaque espace de travail, y compris celui-ci, peut connecter son propre compte.`,
    needsAdmin: (provider: string) => `Un administrateur doit configurer ${provider} pour ce déploiement avant de pouvoir le connecter.`,
    missingPermissionsTitle: (provider: string) => `${provider} n’a pas accordé l’accès dont STL Quest a besoin`,
    missingPermissions: (provider: string) =>
      `Il manque des autorisations à l’application ${provider} du déploiement. Un administrateur doit la mettre à jour dans Intégrations, puis vous pourrez vous reconnecter.`,
    setUpApp: (provider: string) => `Configurer l’application ${provider}`,
    opening: (provider: string) => `Ouverture de ${provider}…`,
    connectMine: (provider: string) => `Connecter mon ${provider}`,
    reconnectMine: (provider: string) => `Reconnecter mon ${provider}`,
    disconnecting: 'Déconnexion…',
    disconnect: 'Déconnecter',
  },
  cloudHelp: {
    dropbox: {
      credentials: 'Créez une application à portée limitée avec un accès App folder, puis ajoutez l’URI de redirection ci-dessous.',
      intro: 'Dropbox stocke les fichiers dans son dossier d’application dédié.',
      permissions: 'Activez account_info.read, files.metadata.read, files.content.read et files.content.write.',
      clientId: 'Clé d’application',
      secret: 'Secret d’application',
    },
    'google-drive': {
      credentials: 'Activez l’API Google Drive et créez un client OAuth pour une application Web.',
      intro: 'Google Drive stocke cet espace de travail dans un dossier créé par STL Quest avec l’autorisation limitée drive.file.',
      permissions: 'Ajoutez l’URI de redirection ci-dessous aux URI de redirection autorisés du client OAuth.',
      clientId: 'ID client',
      secret: 'Secret client',
    },
    onedrive: {
      credentials:
        'Inscrivez une application, choisissez « Any Entra ID Tenant + Personal Microsoft accounts », puis sélectionnez Web sous URI de redirection et collez l’URI de redirection OAuth affiché ci-dessous.',
      intro: 'OneDrive stocke les fichiers dans le dossier Applications dédié à l’application.',
      permissions:
        'Après l’inscription, copiez l’ID d’application (client), créez un secret client et ajoutez les autorisations Microsoft Graph déléguées User.Read, Files.ReadWrite et offline_access.',
      clientId: 'ID client',
      secret: 'Secret client',
    },
    box: {
      credentials: 'Créez une Custom App avec OAuth 2.0, puis ajoutez l’URI de redirection ci-dessous.',
      intro: 'Box stocke cet espace de travail dans un dossier créé par STL Quest.',
      permissions: 'Activez Read and write all files and folders stored in Box, puis soumettez la configuration de l’application.',
      clientId: 'ID client',
      secret: 'Secret client',
    },
  },
  appDialog: {
    openConsole: (provider: string) => `Ouvrir la console développeur ${provider}`,
    copyCredentials:
      'Copiez les identifiants ci-dessous. Chaque espace de travail connecte ensuite son propre compte depuis Paramètres → Stockage.',
    redirectUri: 'URI de redirection OAuth',
    credentials: 'Identifiants de l’application',
    keepSecret: 'Laissez vide pour conserver le secret actuel',
    notSavedTitle: (provider: string) => `${provider} n’a pas été enregistré`,
    notSavedHint: (provider: string) => `Vérifiez que les identifiants correspondent à l’application dans la console ${provider}.`,
    remove: 'Supprimer l’application',
  },
  integrations: {
    title: 'Stockage cloud',
    description:
      'Inscrivez une application par fournisseur pour que chaque espace de travail puisse connecter son propre compte. Chaque propriétaire d’espace de travail se connecte lui-même, et ses modèles restent dans son propre compte.',
    enabled: 'Disponible pour les espaces de travail',
    disabled: 'Désactivé',
    notSetUp: 'Non configuré',
    enable: (provider: string) => `Activer ${provider}`,
    disable: (provider: string) => `Désactiver ${provider}`,
    editApp: 'Modifier l’application',
    setUpApp: 'Configurer l’application',
  },
  change: {
    notEmptyTitle: (kind) => `${kind === 'bucket' ? 'Ce bucket' : 'Ce dossier'} n’est pas vide`,
    moveTitle: 'Déplacer vos fichiers vers le nouvel emplacement ?',
    occupiedDescription: (files: number, folders: number, size: string) =>
      `${inventory(files, folders, size)} ${files + folders <= 1 ? 's’y trouve' : 's’y trouvent'} déjà. Choisissez ce qu’il en advient avant que STL Quest commence à l’utiliser.`,
    moveDescription: 'STL Quest copie et vérifie chaque fichier dans le nouvel emplacement avant sa mise en service.',
    from: 'De',
    to: 'Vers',
    seeContents: 'Voir ce qui s’y trouve déjà',
    truncated: 'Affichage des 100 premiers éléments.',
    preserveTitle: 'Ne pas y toucher',
    preserveDescription: (kind) =>
      `STL Quest ajoute son propre dossier d’espace de travail à côté de ce qui se trouve déjà dans ${kindPhrase(kind)}. Rien d’existant n’est lu, déplacé ni supprimé.`,
    clearTitle: 'Tout supprimer d’abord',
    clearDescription: (files: number, folders: number, size: string) =>
      `Supprime définitivement ${inventory(files, folders, size)}, y compris les fichiers d’autres espaces de travail STL Quest. Cette action est irréversible.`,
    acknowledge: (kind) => `Je comprends que tout le contenu actuel de ${kindPhrase(kind)} sera supprimé définitivement.`,
    migrationNote:
      'Votre stockage actuel continue d’alimenter le tableau jusqu’à la fin de la copie et de la vérification, donc rien n’est perdu si le déplacement échoue.',
    immediateNote: 'Le nouvel emplacement est utilisé dès que vous confirmez.',
    deleteAndSwitch: 'Supprimer et basculer',
    copyAndSwitch: 'Copier les fichiers et basculer',
    startUsing: 'Commencer à l’utiliser',
  },
  migration: {
    starting: 'Démarrage de la migration…',
    preparing: 'Validation et préparation de la destination. Le stockage actuel reste actif.',
    cancelling: 'Annulation de la migration…',
    running: 'Migration du stockage',
    completed: 'Migration terminée',
    cancelled: 'Migration annulée',
    failed: 'Échec de la migration',
    finishingStep: 'Fin de l’étape en cours',
    clearing: 'Suppression du contenu de la destination',
    copying: 'Copie et vérification des fichiers',
    progressLabel: 'Progression de la migration du stockage',
    progress: (copiedFiles: number, totalFiles: number, copiedSize: string, totalSize: string | undefined) =>
      `${copiedFiles} sur ${totalFiles || '…'} fichier${totalFiles > 1 ? 's' : ''} · ${copiedSize} sur ${totalSize ?? 'calcul en cours…'}`,
    copyingFile: (name: string) => `Copie de ${name}`,
    stopping: 'Fin du fichier en cours avant l’arrêt. Le stockage d’origine reste actif.',
    originalActive: 'Le stockage d’origine reste actif jusqu’à la fin de la vérification.',
    requesting: 'Demande en cours…',
    cancel: 'Annuler la migration',
    retrying: 'Nouvelle tentative…',
    retry: 'Relancer la migration',
    cleaningUp: 'Nettoyage…',
    abandon: 'Abandonner la migration',
  },
  usage: {
    label: 'Utilisation du stockage géré',
    usedOrReserved: (size: string) => `${size} utilisés ou réservés`,
    available: (size: string) => `${size} disponibles`,
  },
  upgrade: {
    askAdmin: 'Demandez à un administrateur de l’espace de travail de passer à une offre supérieure pour plus de stockage.',
    label: (plan: string, size: string) => `Passer à l’offre ${plan} pour ${size} de stockage`,
    action: (plan: string) => `Passer à l’offre ${plan}`,
  },
  folderPicker: {
    title: 'Choisir un dossier du serveur',
    description:
      'Voici les dossiers visibles dans le serveur ou le conteneur STL Quest. Les dossiers de l’hôte doivent être montés pour apparaître ici.',
    root: 'Système de fichiers du serveur',
    tree: 'Dossiers du serveur',
    unreadable: (path: string) => `${path} n’a pas pu être lu.`,
    problemTitle: 'Ce dossier n’a pas pu être ouvert',
    problemHint: 'Le serveur n’a peut-être pas l’autorisation de le lire, ou il n’est peut-être pas monté dans le conteneur.',
    select: 'Sélectionner le dossier',
  },
  migrationFailures: {
    quota: (path, size) =>
      `Le stockage géré a refusé ${path} (${size}), car sa copie dépasserait votre quota de stockage. Libérez de l’espace ou augmentez le quota, puis relancez la migration.`,
    cloudflareUploadLimit: (path, size) =>
      `Cloudflare a refusé ${path} (${size}), car il dépasse la limite de téléversement de l’offre. Faites passer le point de terminaison WebDAV par Tailscale Funnel en suivant le guide de configuration WebDAV, puis relancez la migration.`,
    webdavUploadLimit: (path, size) =>
      `WebDAV a refusé ${path} (${size}), car il dépasse la limite de téléversement du serveur ou du proxy. Augmentez la limite ou utilisez un point de terminaison direct comme Tailscale Funnel, puis relancez la migration.`,
  },
  problems: {
    unreadable: 'le dossier n’est pas lisible',
    notAFolder: 'le chemin n’est pas un dossier',
    missing: 'le dossier n’existe pas',
    unusable: (detail: string) => `le stockage est injoignable ou non accessible en écriture : ${detail}`,
    uninspectable: (detail: string) => `le stockage est accessible en écriture mais son contenu ne peut pas être inspecté : ${detail}`,
  },
  errors: {
    missingWebdavPassword: 'mot de passe WebDAV manquant',
    invalidWebdavFolder: 'dossier WebDAV non valide',
    missingSecretAccessKey: 'clé d’accès secrète manquante',
    invalidPrefix: 'préfixe non valide',
    managedUnavailable: 'le stockage géré n’est pas disponible sur ce déploiement',
    localUnavailable: 'le stockage local n’est pas disponible dans ce mode de déploiement',
    webdavHttps: 'le stockage WebDAV hébergé doit utiliser HTTPS',
    endpointRejected: (reason: string) => `point de terminaison de stockage refusé : ${reason}`,
    endpointNotAllowed: 'point de terminaison de stockage non autorisé',
    cloudAppMissing: (provider: string) => `${provider} n’est pas configuré pour ce déploiement`,
    migrationInProgress: 'une migration du stockage est déjà en cours',
    assetsPaused: 'une migration du stockage est en cours : les modifications de fichiers sont temporairement suspendues',
    sameDestination: 'choisissez un autre emplacement de stockage',
    noFailedMigration: 'aucune migration du stockage échouée à relancer',
    failedMigrationChanged: 'la migration du stockage échouée a changé : rechargez la page et réessayez',
    noRunningMigration: 'aucune migration du stockage en cours à annuler',
    operationsActive: 'attendez la fin des opérations sur les fichiers et des téléversements en cours avant de migrer le stockage',
    migrationElsewhere: 'une migration du stockage est déjà en cours sur une autre réplique',
  },
}
