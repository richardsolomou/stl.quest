import { MAX_SPOOLMAN_BODY_BYTES } from '../core/spoolman'
import { readIngest, ingestProblem } from './ingest'
import { serverMessages } from './locale'
import { fixedWindowLimiter } from './rateLimit'
import { spoolmanIngestSchema } from './schemas'

/** A bridge debounces to one request every few seconds, so this leaves room for bursts from other tools. */
const takeRequest = fixedWindowLimiter(60, 60_000)

/** Receives spools for the workspace whose token the request carries; the token can only add spools, never read them back. */
export async function receiveSpoolmanRequest(request: Request) {
  const invalid = serverMessages().server.spoolman.invalid
  const read = await readIngest(request, { maxBytes: MAX_SPOOLMAN_BODY_BYTES, limiter: takeRequest, invalid })
  if (read instanceof Response) return read
  const change = spoolmanIngestSchema.safeParse(read.json)
  if (!change.success) return ingestProblem(400, invalid)
  await read.context.service.receiveSpoolman(change.data)
  return new Response(null, { status: 204 })
}
