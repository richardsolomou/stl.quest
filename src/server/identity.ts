import { getRequestHeader } from '@tanstack/react-start/server'

export function readUserEmail(): string {
  const email = getRequestHeader('Cf-Access-Authenticated-User-Email')
  if (email) return email.toLowerCase()
  if (process.env.NODE_ENV !== 'production' && process.env.DEV_USER_EMAIL) {
    return process.env.DEV_USER_EMAIL.toLowerCase()
  }
  throw new Response('unauthenticated', { status: 401 })
}

export function isAdmin(email: string): boolean {
  return (process.env.ADMIN_EMAILS ?? '')
    .toLowerCase()
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .includes(email)
}

export function requireAdmin(): string {
  const email = readUserEmail()
  if (!isAdmin(email)) throw new Response('forbidden', { status: 403 })
  return email
}
