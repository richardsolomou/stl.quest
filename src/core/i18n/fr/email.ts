import type { email as en } from '../en/email'

export const email: typeof en = {
  footer: (workspaceName) => `Envoyé par ${workspaceName} via STL Quest.`,
  printReady: {
    subject: (copies, workspaceName) =>
      copies <= 1 ? `Votre impression est prête dans ${workspaceName}` : `Vos impressions sont prêtes dans ${workspaceName}`,
    intro: (copies, workspaceName) =>
      copies <= 1
        ? `Une copie de vos demandes est prête à être récupérée dans ${workspaceName} :`
        : `${copies} copies de vos demandes sont prêtes à être récupérées dans ${workspaceName} :`,
    item: (name, copies) => `${name} (${copies} ${copies <= 1 ? 'copie' : 'copies'})`,
    more: (requests) => `et ${requests} ${requests <= 1 ? 'autre demande' : 'autres demandes'}`,
    action: 'Voir vos demandes',
    note: 'Vous pouvez désactiver ces e-mails dans les paramètres de votre compte STL Quest.',
    templateSubject: (workspaceName) => `Vos impressions sont prêtes dans ${workspaceName}`,
    templateIntro: (name, workspaceName) => `Bonjour ${name}, vos impressions sont prêtes à être récupérées dans ${workspaceName} :`,
  },
  invite: {
    subject: (workspaceName) => `Vous êtes invité à rejoindre ${workspaceName} sur STL Quest`,
    intro: (workspaceName) => `Vous avez été invité à envoyer des demandes d’impression à ${workspaceName} sur STL Quest.`,
    action: 'Créer votre compte',
    note: 'Ce lien à usage unique expire dans sept jours.',
  },
  mailServerTest: {
    subject: (workspaceName) => `${workspaceName} peut envoyer des e-mails depuis votre serveur de messagerie`,
    intro: (workspaceName) =>
      `STL Quest s’est connecté à votre serveur de messagerie et a envoyé ce message : les invitations et les e-mails d’impressions prêtes de ${workspaceName} passent désormais par lui.`,
    note: 'Vous pouvez modifier ou supprimer le serveur de messagerie dans les paramètres E-mail de STL Quest.',
  },
  auth: {
    expiry: 'Ce lien expire dans une heure.',
    resetPassword: {
      subject: 'Réinitialisez votre mot de passe STL Quest',
      text: (url) => `Réinitialisez votre mot de passe STL Quest à l’aide de ce lien : ${url}`,
      html: 'Réinitialisez votre mot de passe STL Quest à l’aide du lien ci-dessous.',
      action: 'Réinitialiser le mot de passe',
    },
    verifyEmail: {
      subject: 'Vérifiez votre adresse e-mail STL Quest',
      text: (url) => `Vérifiez votre adresse e-mail STL Quest à l’aide de ce lien : ${url}`,
      html: 'Vérifiez votre adresse e-mail STL Quest à l’aide du lien ci-dessous.',
      action: 'Vérifier l’adresse e-mail',
    },
  },
}
