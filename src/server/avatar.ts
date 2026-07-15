import crypto from 'node:crypto'

export function userImage(email: string, image?: string | null) {
  if (image) return image
  const hash = crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
  return `https://www.gravatar.com/avatar/${hash}?d=identicon&s=160`
}
