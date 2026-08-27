type UserEntry = { id: string; name: string; color?: string }

type Requester = { requesterId: string; requesterName: string }

/**
 * People are cool ink; stages are warm signal. Keeping requester colours inside one cool band means a
 * generated colour can never be mistaken for a stage dot, a fit warning, or blueprint linework.
 * Every entry clears 5.3:1 on the floor, card, and ticket surfaces.
 */
export const requesterColors = ['#7fa6d9', '#8f9ee0', '#a394dd', '#b98fd4', '#cf8cc4', '#dd8aa8', '#9fb0c4', '#c0a9bd'] as const

export function requesterLabel(request: Requester): string {
  return request.requesterName?.trim() || 'Requester'
}

/** One person, one ink, wherever they appear — the card avatar and the detail chip must agree. */
export function requesterInk(name: string): string {
  let hash = 0
  for (const char of name.trim().toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return requesterColors[hash % requesterColors.length]
}

export function requesterColor(request: Requester, users: UserEntry[]): string {
  return users.find((user) => user.id === request.requesterId)?.color ?? requesterInk(requesterLabel(request))
}
