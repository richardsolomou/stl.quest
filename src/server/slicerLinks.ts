import crypto from 'node:crypto'
import { z } from 'zod'

/** Long enough for a slicer to start and fetch the file, short enough that a leaked link soon stops working. */
export const SLICER_LINK_TTL_MS = 5 * 60_000

export type SlicerLinkClaims = { workspaceId: string; requestId: string; userId: string }

const claimsSchema = z.object({
  workspaceId: z.string().min(1).max(200),
  requestId: z.string().min(1).max(200),
  userId: z.string().min(1).max(200),
  expiresAt: z.number().int(),
})

function signature(secret: string, payload: string) {
  return crypto.createHmac('sha256', secret).update(`stlquest-slicer-link:${payload}`).digest()
}

/**
 * A path a slicer can download one request's model from without the browser session. The signature is the last
 * segment because OrcaSlicer names the saved file after that segment when it has an extension, and only otherwise
 * takes the server's Content-Disposition name; base64url has no dots, so it never does.
 */
export function signSlicerLink(secret: string, claims: SlicerLinkClaims, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ ...claims, expiresAt: now + SLICER_LINK_TTL_MS })).toString('base64url')
  return `/api/slicer/${payload}/${signature(secret, payload).toString('base64url')}`
}

/** The claims a link was signed with, or undefined when it was altered, signed by another deployment, or has expired. */
export function verifySlicerLink(secret: string, payload: string, signed: string, now = Date.now()) {
  const expected = signature(secret, payload)
  const given = Buffer.from(signed, 'base64url')
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return undefined
  }
  const claims = claimsSchema.safeParse(parsed)
  return claims.success && now <= claims.data.expiresAt ? claims.data : undefined
}
