import type { Doc } from '../../convex/_generated/dataModel'

export type UserEntry = { name: string; color?: string }

/** Display label for who a print is for: explicit name, else the uploader. */
export function requesterLabel(job: Doc<'jobs'>): string {
  return job.requesterName?.trim() || job.requesterEmail.split('@')[0]
}

/** The person's stored color, with a hash fallback for names not in the users table. */
export function requesterColor(job: Doc<'jobs'>, users: UserEntry[]): string {
  const label = requesterLabel(job)
  const stored = users.find((user) => user.name === label)?.color
  if (stored) return stored
  let hash = 0
  for (const char of label.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return `hsl(${hash % 360} 45% 65%)`
}
