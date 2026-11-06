export const email = {
  footer: (workspaceName: string) => `Sent by ${workspaceName} through STL Quest.`,
  printReady: {
    subject: (copies: number, workspaceName: string) =>
      copies === 1 ? `Your print is ready in ${workspaceName}` : `Your prints are ready in ${workspaceName}`,
    intro: (copies: number, workspaceName: string) =>
      copies === 1
        ? `A copy of your requests is ready to collect in ${workspaceName}:`
        : `${copies} copies of your requests are ready to collect in ${workspaceName}:`,
    item: (name: string, copies: number) => `${name} (${copies} ${copies === 1 ? 'copy' : 'copies'})`,
    more: (requests: number) => `and ${requests} more ${requests === 1 ? 'request' : 'requests'}`,
    action: 'View your requests',
    note: 'You can turn these emails off from your STL Quest account settings.',
    templateSubject: (workspaceName: string) => `Your prints are ready in ${workspaceName}`,
    templateIntro: (name: string, workspaceName: string) => `Hi ${name}, your prints are ready to collect in ${workspaceName}:`,
  },
  invite: {
    subject: (workspaceName: string) => `You are invited to ${workspaceName} on STL Quest`,
    intro: (workspaceName: string) => `You have been invited to send print requests to ${workspaceName} on STL Quest.`,
    action: 'Create your account',
    note: 'This single-use link expires in seven days.',
  },
  mailServerTest: {
    subject: (workspaceName: string) => `${workspaceName} can send email from your mail server`,
    intro: (workspaceName: string) =>
      `STL Quest signed in to your mail server and sent this message, so invitations and print-ready emails from ${workspaceName} now come from it.`,
    note: 'You can change or remove the mail server from the Email settings in STL Quest.',
  },
  auth: {
    expiry: 'This link expires in one hour.',
    resetPassword: {
      subject: 'Reset your STL Quest password',
      text: (url: string) => `Reset your STL Quest password using this link: ${url}`,
      html: 'Reset your STL Quest password using the link below.',
      action: 'Reset password',
    },
    verifyEmail: {
      subject: 'Verify your STL Quest email address',
      text: (url: string) => `Verify your STL Quest email address using this link: ${url}`,
      html: 'Verify your STL Quest email address using the link below.',
      action: 'Verify email address',
    },
  },
}
