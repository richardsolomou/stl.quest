import crypto from 'node:crypto'
import { z } from 'zod'

/** Long enough for a slicer to start and fetch the file, short enough that a leaked link soon stops working. */
export const SLICER_LINK_TTL_MS = 5 * 60_000

/** A link opens one request's model, or one plate's models combined into a single file. */
export type SlicerLinkClaims = { workspaceId: string; userId: string } & ({ requestId: string } | { plateId: string })

const id = z.string().min(1).max(200)
const common = { workspaceId: id, userId: id, expiresAt: z.number().int() }
const claimsSchema = z.union([z.strictObject({ ...common, requestId: id }), z.strictObject({ ...common, plateId: id })])

function signature(secret: string, payload: string) {
  return crypto.createHmac('sha256', secret).update(`stlquest-slicer-link:${payload}`).digest()
}

/**
 * A path a slicer can download a request's model or a plate's file from without the browser session. The signature is the last
 * segment because OrcaSlicer names the saved file after that segment when it has an extension, and only otherwise
 * takes the server's Content-Disposition name; base64url has no dots, so it never does.
 */
export function signSlicerLink(secret: string, claims: SlicerLinkClaims, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ ...claims, expiresAt: now + SLICER_LINK_TTL_MS })).toString('base64url')
  return `/api/slicer/${payload}/${signature(secret, payload).toString('base64url')}`
}

/** The claims a link was signed with, or undefined when it was altered, signed by another deployment, or has expired. */
export function verifySlicerLink(secret: string, payload: string, signed: string, now = Date.now()) {
  // Compared as text: decoding first would accept other spellings of the same bytes, since base64url's last character
  // carries unused bits.
  const expected = Buffer.from(signature(secret, payload).toString('base64url'))
  const given = Buffer.from(signed)
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
