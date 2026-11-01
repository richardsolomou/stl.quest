import { renderEmail } from './email'

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

export function printReadyEmail(input: {
  workspaceName: string
  logoSrc?: string
  prints: { name: string; count: number }[]
  url?: string
}) {
  const copies = input.prints.reduce((sum, print) => sum + print.count, 0)
  return renderEmail({
    workspaceName: input.workspaceName,
    logoSrc: input.logoSrc,
    subject: copies === 1 ? `Your print is ready in ${input.workspaceName}` : `Your prints are ready in ${input.workspaceName}`,
    intro: `${copies === 1 ? 'A copy' : `${copies} copies`} of your requests ${copies === 1 ? 'is' : 'are'} ready to collect in ${input.workspaceName}:`,
    items: input.prints.map((print) => `${print.name} (${print.count} ${print.count === 1 ? 'copy' : 'copies'})`),
    action: input.url ? { label: 'View your requests', url: input.url } : undefined,
    note: 'You can turn these emails off from your STL Quest account settings.',
  })
}

export function inviteEmail(input: { workspaceName: string; logoSrc?: string; url: string }) {
  return renderEmail({
    workspaceName: input.workspaceName,
    logoSrc: input.logoSrc,
    subject: `You are invited to ${input.workspaceName} on STL Quest`,
    intro: `You have been invited to send print requests to ${input.workspaceName} on STL Quest.`,
    action: { label: 'Create your account', url: input.url },
    note: 'This single-use link expires in seven days.',
  })
}
