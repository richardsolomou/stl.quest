import { MAX_SPOOLMAN_BODY_BYTES, SPOOLMAN_TOKEN_PREFIX } from '../core/spoolman'
import { app, hashToken } from './app'
import { serverMessages } from './locale'
import { fixedWindowLimiter } from './rateLimit'
import { readLimitedBody } from './readLimitedBody'
import { spoolmanIngestSchema } from './schemas'

/** A bridge debounces to one request every few seconds, so this leaves room for bursts from other tools. */
const takeRequest = fixedWindowLimiter(60, 60_000)

const problem = (status: number, error: string, headers?: Record<string, string>) => Response.json({ error }, { status, headers })

/**
 * Receives spools for the workspace whose token the request carries. The token is its only credential: cookies are
 * never read, so a browser cannot be made to send one, and it can only add spools, never read anything back. It is
 * checked before the body is read, and the body is bounded before it is parsed.
 */
export async function receiveSpoolmanRequest(request: Request) {
  const text = serverMessages().server.spoolman
  const token = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')?.[1]
  if (!token?.startsWith(SPOOLMAN_TOKEN_PREFIX) || token.length > 128)
    return problem(401, text.notConnected, { 'WWW-Authenticate': 'Bearer' })
  const tokenHash = hashToken(token)
  const limit = takeRequest(tokenHash)
  if (!limit.allowed) return problem(429, text.rateLimited, { 'Retry-After': String(limit.retryAfterSeconds) })
  const context = await (await app()).spoolmanWorkspace(tokenHash)
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) return problem(415, text.invalid)
  const body = await readLimitedBody(request, MAX_SPOOLMAN_BODY_BYTES)
  if (!body) return problem(413, text.tooLarge(MAX_SPOOLMAN_BODY_BYTES / 1024 / 1024))
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(body))
  } catch {
    return problem(400, text.invalid)
  }
  const change = spoolmanIngestSchema.safeParse(json)
  if (!change.success) return problem(400, text.invalid)
  await context.service.receiveSpoolman(change.data)
  return new Response(null, { status: 204 })
}
