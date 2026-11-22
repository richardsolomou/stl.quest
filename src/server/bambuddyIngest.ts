import { bambuddyReport, MAX_PRINT_EVENT_BODY_BYTES } from '../core/printJobs'
import { readIngest, ingestProblem } from './ingest'
import { serverMessages } from './locale'
import { fixedWindowLimiter } from './rateLimit'
import { bambuddyEventSchema, bambuddyUsageSchema } from './schemas'

/** Bambuddy sends a few notifications per print, so this leaves room for a farm of printers finishing together. */
const takeRequest = fixedWindowLimiter(60, 60_000)

/**
 * Receives Bambuddy's generic webhook for the workspace whose ingest token it carries. Print start, finish, failure,
 * and stop are kept; any other notification, Bambuddy's test included, is accepted and dropped so Bambuddy reports
 * it delivered. The bridge sends `print_usage` here too, with what a print used per Spoolman spool. The token can only
 * add prints, never read anything back.
 */
export async function receiveBambuddyRequest(request: Request) {
  const invalid = serverMessages().server.prints.invalid
  const read = await readIngest(request, { maxBytes: MAX_PRINT_EVENT_BODY_BYTES, limiter: takeRequest, invalid })
  if (read instanceof Response) return read
  if ((read.json as { event?: unknown } | null)?.event === 'print_usage') {
    const usage = bambuddyUsageSchema.safeParse(read.json)
    if (!usage.success) return ingestProblem(400, serverMessages().server.prints.invalidUsage)
    await read.context.service.receivePrintUsage(usage.data)
    return new Response(null, { status: 204 })
  }
  const event = bambuddyEventSchema.safeParse(read.json)
  if (!event.success) return ingestProblem(400, invalid)
  const report = bambuddyReport(event.data)
  if (report) await read.context.service.receivePrint(report)
  return new Response(null, { status: 204 })
}
