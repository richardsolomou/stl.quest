import crypto from 'node:crypto'
import { normalizeEmail } from '../core/identity'

export function userImage(email: string, image?: string | null) {
  if (image) return image
  const hash = crypto.createHash('sha256').update(normalizeEmail(email)).digest('hex')
  return `https://www.gravatar.com/avatar/${hash}?d=identicon&s=160`
}
