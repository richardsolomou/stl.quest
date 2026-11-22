import { SPOOLMAN_TOKEN_PREFIX } from '../core/spoolman'
import { app, hashToken } from './app'
import { serverMessages } from './locale'
import { fixedWindowLimiter } from './rateLimit'
import { readLimitedBody } from './readLimitedBody'

export const ingestProblem = (status: number, error: string, headers?: Record<string, string>) =>
  Response.json({ error }, { status, headers })

/**
 * Finds the workspace of a request to an ingest endpoint: tools next to the user's own services push to STL Quest with
 * the workspace's ingest token, its only credential. Cookies are never read, so a browser cannot be made to send one.
 * The token is checked and rate limited before anything else; a Response is a refusal to send back as it is.
 */
export async function ingestWorkspace(request: Request, limiter: ReturnType<typeof fixedWindowLimiter>) {
  const text = serverMessages().server.spoolman
  const token = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')?.[1]
  if (!token?.startsWith(SPOOLMAN_TOKEN_PREFIX) || token.length > 128)
    return ingestProblem(401, text.notConnected, { 'WWW-Authenticate': 'Bearer' })
  const tokenHash = hashToken(token)
  const limit = limiter(tokenHash)
  if (!limit.allowed) return ingestProblem(429, text.rateLimited, { 'Retry-After': String(limit.retryAfterSeconds) })
  return await (await app()).spoolmanWorkspace(tokenHash)
}

/** Reads a push to an ingest endpoint: the workspace first, then a body of `contentType` bounded as it streams in. */
export async function readIngestBytes(
  request: Request,
  {
    maxBytes,
    limiter,
    invalid,
    contentType,
  }: { maxBytes: number; limiter: ReturnType<typeof fixedWindowLimiter>; invalid: string; contentType: RegExp },
) {
  const context = await ingestWorkspace(request, limiter)
  if (context instanceof Response) return context
  if (!contentType.test(request.headers.get('content-type') ?? '')) {
    await request.body?.cancel()
    return ingestProblem(415, invalid)
  }
  const body = await readLimitedBody(request, maxBytes)
  if (!body) return ingestProblem(413, serverMessages().server.spoolman.tooLarge(maxBytes / 1024 / 1024))
  return { context, body }
}

/** Reads a JSON push to an ingest endpoint, bounded before it is parsed. */
export async function readIngest(
  request: Request,
  { maxBytes, limiter, invalid }: { maxBytes: number; limiter: ReturnType<typeof fixedWindowLimiter>; invalid: string },
) {
  const read = await readIngestBytes(request, { maxBytes, limiter, invalid, contentType: /^application\/json\b/i })
  if (read instanceof Response) return read
  try {
    return { context: read.context, json: JSON.parse(new TextDecoder().decode(read.body)) as unknown }
  } catch {
    return ingestProblem(400, invalid)
  }
}
