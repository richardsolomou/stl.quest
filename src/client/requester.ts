type UserEntry = { id: string; name: string; color?: string }

type Requester = { requesterId: string; requesterName: string }

/**
 * People are cool ink; stages are warm signal. Keeping requester colours inside one cool band means a
 * generated colour can never be mistaken for a stage dot, a fit warning, or blueprint linework.
 * Every entry clears 5.3:1 on the floor, card, and ticket surfaces in both themes; `src/theme.css` holds the values.
 */
export const requesterColors = [1, 2, 3, 4, 5, 6, 7, 8].map((index) => `var(--requester-${index})`)

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
