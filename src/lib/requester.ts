type UserEntry = { name: string; color?: string }

type Requester = { requesterName?: string; requesterEmail?: string }

/** Display label for who a print is for: explicit name, else the uploader. */
export function requesterLabel(job: Requester): string {
  return job.requesterName?.trim() || job.requesterEmail?.split('@')[0] || 'Requester'
}

/** The person's stored color, with a hash fallback for names not in the users table. */
export function requesterColor(job: Requester, users: UserEntry[]): string {
  const label = requesterLabel(job)
  const stored = users.find((user) => user.name === label)?.color
  if (stored) return stored
  let hash = 0
  for (const char of label.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return `hsl(${hash % 360} 45% 65%)`
}
