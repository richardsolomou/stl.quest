import type { email as en } from '../en/email'

export const email: typeof en = {
  footer: (workspaceName) => `Gesendet von ${workspaceName} über STL Quest.`,
  printReady: {
    subject: (copies, workspaceName) =>
      copies === 1 ? `Ihr Druck ist in ${workspaceName} fertig` : `Ihre Drucke sind in ${workspaceName} fertig`,
    intro: (copies, workspaceName) =>
      copies === 1
        ? `Eine Kopie Ihrer Anfragen liegt in ${workspaceName} zur Abholung bereit:`
        : `${copies} Kopien Ihrer Anfragen liegen in ${workspaceName} zur Abholung bereit:`,
    item: (name, copies) => `${name} (${copies} ${copies === 1 ? 'Kopie' : 'Kopien'})`,
    more: (requests) => `und ${requests} ${requests === 1 ? 'weitere Anfrage' : 'weitere Anfragen'}`,
    action: 'Ihre Anfragen ansehen',
    note: 'Sie können diese E-Mails in den Kontoeinstellungen von STL Quest abschalten.',
    templateSubject: (workspaceName) => `Ihre Drucke sind in ${workspaceName} fertig`,
    templateIntro: (name, workspaceName) => `Hallo ${name}, Ihre Drucke liegen in ${workspaceName} zur Abholung bereit:`,
  },
  invite: {
    subject: (workspaceName) => `Sie sind zu ${workspaceName} auf STL Quest eingeladen`,
    intro: (workspaceName) => `Sie wurden eingeladen, Druckanfragen an ${workspaceName} auf STL Quest zu senden.`,
    action: 'Konto erstellen',
    note: 'Dieser Link kann nur einmal verwendet werden und läuft in sieben Tagen ab.',
  },
  mailServerTest: {
    subject: (workspaceName) => `${workspaceName} kann E-Mails über Ihren Mailserver senden`,
    intro: (workspaceName) =>
      `STL Quest hat sich bei Ihrem Mailserver angemeldet und diese Nachricht gesendet. Einladungen und Benachrichtigungen über fertige Drucke von ${workspaceName} werden ab jetzt darüber verschickt.`,
    note: 'Sie können den Mailserver in den E-Mail-Einstellungen von STL Quest ändern oder entfernen.',
  },
  auth: {
    expiry: 'Dieser Link läuft in einer Stunde ab.',
    resetPassword: {
      subject: 'Passwort für STL Quest zurücksetzen',
      text: (url) => `Setzen Sie Ihr Passwort für STL Quest über diesen Link zurück: ${url}`,
      html: 'Setzen Sie Ihr Passwort für STL Quest über den folgenden Link zurück.',
      action: 'Passwort zurücksetzen',
    },
    verifyEmail: {
      subject: 'E-Mail-Adresse für STL Quest bestätigen',
      text: (url) => `Bestätigen Sie Ihre E-Mail-Adresse für STL Quest über diesen Link: ${url}`,
      html: 'Bestätigen Sie Ihre E-Mail-Adresse für STL Quest über den folgenden Link.',
      action: 'E-Mail-Adresse bestätigen',
    },
  },
}
