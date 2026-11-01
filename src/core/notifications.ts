import {
  brandHtml,
  fillEmailTemplate,
  itemsHtml,
  plainPlaceholder,
  renderEmail,
  type EmailPlaceholders,
  type EmailTemplate,
  type EmailTemplateKind,
} from './email'

export const notificationKinds = [
  {
    id: 'print-ready',
    name: 'Prints ready',
    description: 'Email me when copies of my requests reach Ready.',
    enabledByDefault: true,
  },
] as const

export type NotificationKind = (typeof notificationKinds)[number]['id']
export type NotificationPreferences = Record<NotificationKind, boolean>

export function isNotificationKind(value: string): value is NotificationKind {
  return notificationKinds.some((kind) => kind.id === value)
}

export function notificationPreferences(stored: { kind: string; enabled: boolean }[]): NotificationPreferences {
  const overrides = new Map(stored.map(({ kind, enabled }) => [kind, enabled]))
  return Object.fromEntries(
    notificationKinds.map((kind) => [kind.id, overrides.get(kind.id) ?? kind.enabledByDefault]),
  ) as NotificationPreferences
}

export type ReadyCopies = { requestId: string; count: number }
export type ReadyPrint = { requestId: string; name: string; ownerUserId: string; count: number }

/** Groups newly ready copies by requester, skipping requests the actor owns: they already know. */
export function readyPrintsByRequester(prints: ReadyPrint[], actorId: string) {
  const byRequester = new Map<string, Map<string, { name: string; count: number }>>()
  for (const print of prints) {
    if (print.count < 1 || print.ownerUserId === actorId) continue
    const items = byRequester.get(print.ownerUserId) ?? new Map<string, { name: string; count: number }>()
    const existing = items.get(print.requestId)
    items.set(print.requestId, { name: print.name, count: (existing?.count ?? 0) + print.count })
    byRequester.set(print.ownerUserId, items)
  }
  return new Map([...byRequester].map(([ownerUserId, items]) => [ownerUserId, [...items.values()]]))
}

/** A custom template replaces the subject and HTML; the plain-text part keeps the standard wording as a fallback. */
function withTemplate<Kind extends EmailTemplateKind>(
  rendered: ReturnType<typeof renderEmail>,
  template: EmailTemplate | undefined,
  placeholders: EmailPlaceholders<Kind>,
) {
  return template ? { ...rendered, ...fillEmailTemplate(template, placeholders) } : rendered
}

export function printReadyEmail(input: {
  workspaceName: string
  logoSrc?: string
  name?: string
  prints: { name: string; count: number }[]
  url?: string
  template?: EmailTemplate
}) {
  const copies = input.prints.reduce((sum, print) => sum + print.count, 0)
  const items = input.prints.map((print) => `${print.name} (${print.count} ${print.count === 1 ? 'copy' : 'copies'})`)
  const rendered = renderEmail({
    workspaceName: input.workspaceName,
    logoSrc: input.logoSrc,
    subject: copies === 1 ? `Your print is ready in ${input.workspaceName}` : `Your prints are ready in ${input.workspaceName}`,
    intro: `${copies === 1 ? 'A copy' : `${copies} copies`} of your requests ${copies === 1 ? 'is' : 'are'} ready to collect in ${input.workspaceName}:`,
    items,
    action: input.url ? { label: 'View your requests', url: input.url } : undefined,
    note: 'You can turn these emails off from your STL Quest account settings.',
  })
  return withTemplate<'print-ready'>(rendered, input.template, {
    name: plainPlaceholder(input.name ?? ''),
    workspace: plainPlaceholder(input.workspaceName),
    prints: { text: items.join(', '), html: itemsHtml(items) },
    link: plainPlaceholder(input.url ?? ''),
    logo: { text: input.workspaceName, html: brandHtml(input.workspaceName, input.logoSrc) },
  })
}

export function inviteEmail(input: { workspaceName: string; logoSrc?: string; url: string; template?: EmailTemplate }) {
  const rendered = renderEmail({
    workspaceName: input.workspaceName,
    logoSrc: input.logoSrc,
    subject: `You are invited to ${input.workspaceName} on STL Quest`,
    intro: `You have been invited to send print requests to ${input.workspaceName} on STL Quest.`,
    action: { label: 'Create your account', url: input.url },
    note: 'This single-use link expires in seven days.',
  })
  return withTemplate<'invite'>(rendered, input.template, {
    workspace: plainPlaceholder(input.workspaceName),
    link: plainPlaceholder(input.url),
    logo: { text: input.workspaceName, html: brandHtml(input.workspaceName, input.logoSrc) },
  })
}

/** The standard layout with placeholders in place and one tag per line, as a starting point for a custom template. */
export function defaultEmailTemplate(kind: EmailTemplateKind): EmailTemplate {
  const { subject, html } = defaultTemplateMarkup(kind)
  return { subject, html: html.replaceAll('><', '>\n<') }
}

function defaultTemplateMarkup(kind: EmailTemplateKind): EmailTemplate {
  const layout = { workspaceName: '{{workspace}}', brandHtml: '{{logo}}' }
  if (kind === 'invite') {
    const subject = 'You are invited to {{workspace}}'
    return {
      subject,
      html: renderEmail({
        ...layout,
        subject,
        intro: 'You have been invited to send print requests to {{workspace}}.',
        action: { label: 'Create your account', url: '{{link}}' },
        note: 'This single-use link expires in seven days.',
      }).html,
    }
  }
  const subject = 'Your prints are ready in {{workspace}}'
  return {
    subject,
    html: renderEmail({
      ...layout,
      subject,
      intro: 'Hi {{name}}, your prints are ready to collect in {{workspace}}:',
      itemsHtml: '{{prints}}',
      action: { label: 'View your requests', url: '{{link}}' },
      note: 'You can turn these emails off from your STL Quest account settings.',
    }).html,
  }
}

export function mailServerTestEmail(input: { workspaceName: string; logoSrc?: string }) {
  return renderEmail({
    workspaceName: input.workspaceName,
    logoSrc: input.logoSrc,
    subject: `${input.workspaceName} can send email from your mail server`,
    intro: `STL Quest signed in to your mail server and sent this message, so invitations and print-ready emails from ${input.workspaceName} now come from it.`,
    note: 'You can change or remove the mail server from the Email settings in STL Quest.',
  })
}
