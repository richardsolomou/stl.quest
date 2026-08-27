import crypto from 'node:crypto'
import { normalizeEmail } from '../core/identity'

export function userImage(email: string, image?: string | null) {
  if (image) return image
  const hash = crypto.createHash('sha256').update(normalizeEmail(email)).digest('hex')
  // d=404 rather than a generated default: without it Gravatar invents an off-palette identicon for
  // every user who has no account, and the client's initials fallback never gets a chance to render.
  return `https://www.gravatar.com/avatar/${hash}?d=404&s=160`
}
