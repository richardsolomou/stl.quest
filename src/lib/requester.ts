import type { Doc } from '../../convex/_generated/dataModel'

/** Display label for who a print is for: explicit name, else the uploader. */
export function requesterLabel(job: Doc<'jobs'>): string {
  return job.requesterName?.trim() || job.requesterEmail.split('@')[0]
}

/** Stable per-person accent derived from the label, tuned for the dark theme. */
export function requesterColor(job: Doc<'jobs'>): string {
  const key = requesterLabel(job).toLowerCase()
  let hash = 0
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return `hsl(${hash % 360} 45% 65%)`
}
