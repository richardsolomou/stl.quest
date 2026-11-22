import { SPOOLMAN_TOKEN_PREFIX } from '../core/spoolman'
import { app, hashToken } from './app'
import { serverMessages } from './locale'
import { fixedWindowLimiter } from './rateLimit'
import { readLimitedBody } from './readLimitedBody'

export const ingestProblem = (status: number, error: string, headers?: Record<string, string>) =>
  Response.json({ error }, { status, headers })

/**
 * Reads a request to a workspace ingest endpoint: tools next to the user's own services push to STL Quest with the
 * workspace's write-only token, its only credential. Cookies are never read, so a browser cannot be made to send one.
 * The token is checked and rate limited before the body is read, and the body is bounded before it is parsed; a
 * Response is a refusal to send back as it is.
 */
export async function readIngest(
  request: Request,
  { maxBytes, limiter, invalid }: { maxBytes: number; limiter: ReturnType<typeof fixedWindowLimiter>; invalid: string },
) {
  const text = serverMessages().server.spoolman
  const token = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')?.[1]
  if (!token?.startsWith(SPOOLMAN_TOKEN_PREFIX) || token.length > 128)
    return ingestProblem(401, text.notConnected, { 'WWW-Authenticate': 'Bearer' })
  const tokenHash = hashToken(token)
  const limit = limiter(tokenHash)
  if (!limit.allowed) return ingestProblem(429, text.rateLimited, { 'Retry-After': String(limit.retryAfterSeconds) })
  const context = await (await app()).spoolmanWorkspace(tokenHash)
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) return ingestProblem(415, invalid)
  const body = await readLimitedBody(request, maxBytes)
  if (!body) return ingestProblem(413, text.tooLarge(maxBytes / 1024 / 1024))
  try {
    return { context, json: JSON.parse(new TextDecoder().decode(body)) as unknown }
  } catch {
    return ingestProblem(400, invalid)
  }
}
