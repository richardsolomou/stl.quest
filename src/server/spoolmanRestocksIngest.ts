import { restockMarker } from '../core/spoolmanRestocks'
import { ingestProblem, ingestWorkspace, readIngest } from './ingest'
import { serverMessages } from './locale'
import { fixedWindowLimiter } from './rateLimit'
import { spoolmanRestockResultSchema } from './schemas'

/** A bridge collects every minute or so and reports each spool it adds, so this leaves room for a large order. */
const takeRequest = fixedWindowLimiter(120, 60_000)

/**
 * Hands the bridge the spools waiting to be added to Spoolman, as Spoolman's `POST /api/v1/spool` takes them. This is
 * all the ingest token reads: what the workspace's admins queued for its own Spoolman, and nothing else.
 */
export async function sendSpoolmanRestocks(request: Request) {
  const context = await ingestWorkspace(request, takeRequest)
  if (context instanceof Response) return context
  const restocks = await context.service.spoolmanRestocksToAdd()
  return Response.json(
    {
      restocks: restocks.map(({ id, filamentId, grams }) => ({
        id,
        filament_id: filamentId,
        ...(grams !== undefined && { initial_weight: grams }),
        comment: restockMarker(id),
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

/** Takes the spool the bridge added to Spoolman for a queued restock, or why Spoolman refused it. */
export async function receiveSpoolmanRestockResult(request: Request) {
  const invalid = serverMessages().server.spoolman.invalidRestock
  const read = await readIngest(request, { maxBytes: 4 * 1024, limiter: takeRequest, invalid })
  if (read instanceof Response) return read
  const result = spoolmanRestockResultSchema.safeParse(read.json)
  if (!result.success) return ingestProblem(400, invalid)
  await read.context.service.settleSpoolmanRestock(result.data)
  return new Response(null, { status: 204 })
}
