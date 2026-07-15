type UserEntry = { id: string; name: string; color?: string }

type Requester = { requesterId: string; requesterName: string }

export function requesterLabel(request: Requester): string {
  return request.requesterName?.trim() || 'Requester'
}

export function requesterColor(request: Requester, users: UserEntry[]): string {
  const label = requesterLabel(request)
  const stored = users.find((user) => user.id === request.requesterId)?.color
  if (stored) return stored
  let hash = 0
  for (const char of label.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return `hsl(${hash % 360} 45% 65%)`
}
