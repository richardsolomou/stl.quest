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

export function printReadyEmail(input: { workspaceName: string; prints: { name: string; count: number }[]; url?: string }) {
  const copies = input.prints.reduce((sum, print) => sum + print.count, 0)
  const lines = input.prints.map((print) => `${print.name} (${print.count} ${print.count === 1 ? 'copy' : 'copies'})`)
  const subject = copies === 1 ? `Your print is ready in ${input.workspaceName}` : `Your prints are ready in ${input.workspaceName}`
  const intro = `${copies === 1 ? 'A copy' : `${copies} copies`} of your requests ${copies === 1 ? 'is' : 'are'} ready to collect in ${input.workspaceName}:`
  const footer = 'You can turn these emails off from your STL Quest account settings.'
  return {
    subject,
    text: [intro, '', ...lines.map((line) => `- ${line}`), '', ...(input.url ? [input.url, ''] : []), footer].join('\n'),
    html: [
      `<p>${escapeHtml(intro)}</p>`,
      `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`,
      input.url ? `<p><a href="${escapeHtml(input.url)}">Open STL Quest</a></p>` : '',
      `<p>${escapeHtml(footer)}</p>`,
    ].join(''),
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)
}
