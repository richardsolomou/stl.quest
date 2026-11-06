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
import { boundedUserName } from './identity'
import type { Messages } from './i18n'

type EmailMessages = Messages['email']

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

/** Keeps one email a readable size however many prints become ready at once; the rest are counted, not named. */
export const MAX_EMAIL_LISTED_PRINTS = 50

export function printReadyEmail(input: {
  t: EmailMessages
  workspaceName: string
  logoSrc?: string
  name?: string
  prints: { name: string; count: number }[]
  url?: string
  template?: EmailTemplate
}) {
  const { t } = input
  const copies = input.prints.reduce((sum, print) => sum + print.count, 0)
  const listed = input.prints.slice(0, MAX_EMAIL_LISTED_PRINTS).map((print) => t.printReady.item(print.name, print.count))
  const unlisted = input.prints.length - listed.length
  const items = unlisted > 0 ? [...listed, t.printReady.more(unlisted)] : listed
  const rendered = renderEmail({
    workspaceName: input.workspaceName,
    logoSrc: input.logoSrc,
    subject: t.printReady.subject(copies, input.workspaceName),
    intro: t.printReady.intro(copies, input.workspaceName),
    items,
    action: input.url ? { label: t.printReady.action, url: input.url } : undefined,
    note: t.printReady.note,
    footer: t.footer(input.workspaceName),
  })
  return withTemplate<'print-ready'>(rendered, input.template, {
    // Names stored before the limit existed can be longer, and the template may repeat this one.
    name: plainPlaceholder(boundedUserName(input.name ?? '')),
    workspace: plainPlaceholder(input.workspaceName),
    prints: { text: items.join(', '), html: itemsHtml(items) },
    link: plainPlaceholder(input.url ?? ''),
    logo: { text: input.workspaceName, html: brandHtml(input.workspaceName, input.logoSrc) },
  })
}

export function inviteEmail(input: { t: EmailMessages; workspaceName: string; logoSrc?: string; url: string; template?: EmailTemplate }) {
  const { t } = input
  const rendered = renderEmail({
    workspaceName: input.workspaceName,
    logoSrc: input.logoSrc,
    subject: t.invite.subject(input.workspaceName),
    intro: t.invite.intro(input.workspaceName),
    action: { label: t.invite.action, url: input.url },
    note: t.invite.note,
    footer: t.footer(input.workspaceName),
  })
  return withTemplate<'invite'>(rendered, input.template, {
    workspace: plainPlaceholder(input.workspaceName),
    link: plainPlaceholder(input.url),
    logo: { text: input.workspaceName, html: brandHtml(input.workspaceName, input.logoSrc) },
  })
}

/**
 * The standard layout with placeholders in place and one tag per line, as a starting point for a custom template.
 * The standard emails and the default templates share their wording, so a new template starts from what recipients already get.
 */
export function defaultEmailTemplate(kind: EmailTemplateKind, t: EmailMessages): EmailTemplate {
  const { subject, html } = defaultTemplateMarkup(kind, t)
  return { subject, html: html.replaceAll('><', '>\n<') }
}

function defaultTemplateMarkup(kind: EmailTemplateKind, t: EmailMessages): EmailTemplate {
  const workspace = '{{workspace}}'
  const layout = { workspaceName: workspace, brandHtml: '{{logo}}', footer: t.footer(workspace) }
  if (kind === 'invite') {
    const subject = t.invite.subject(workspace)
    return {
      subject,
      html: renderEmail({
        ...layout,
        subject,
        intro: t.invite.intro(workspace),
        action: { label: t.invite.action, url: '{{link}}' },
        note: t.invite.note,
      }).html,
    }
  }
  const subject = t.printReady.templateSubject(workspace)
  return {
    subject,
    html: renderEmail({
      ...layout,
      subject,
      intro: t.printReady.templateIntro('{{name}}', workspace),
      itemsHtml: '{{prints}}',
      action: { label: t.printReady.action, url: '{{link}}' },
      note: t.printReady.note,
    }).html,
  }
}

export function mailServerTestEmail(input: { t: EmailMessages; workspaceName: string; logoSrc?: string }) {
  const { t } = input
  return renderEmail({
    workspaceName: input.workspaceName,
    logoSrc: input.logoSrc,
    subject: t.mailServerTest.subject(input.workspaceName),
    intro: t.mailServerTest.intro(input.workspaceName),
    note: t.mailServerTest.note,
    footer: t.footer(input.workspaceName),
  })
}
