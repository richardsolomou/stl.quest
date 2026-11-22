import { bambuddyReport, MAX_PRINT_EVENT_BODY_BYTES } from '../core/printJobs'
import { readIngest, ingestProblem } from './ingest'
import { serverMessages } from './locale'
import { fixedWindowLimiter } from './rateLimit'
import { bambuddyEventSchema, bambuddyUsageSchema } from './schemas'

/** Bambuddy sends a few notifications per print, so this leaves room for a farm of printers finishing together. */
const takeEvent = fixedWindowLimiter(60, 60_000)
/** The bridge's own allowance, so however much it sends, Bambuddy's notifications are never refused for it. */
const takeUsage = fixedWindowLimiter(60, 60_000)

/**
 * Receives Bambuddy's generic webhook for the workspace whose ingest token it carries. Print start, finish, failure,
 * and stop are kept; any other notification, Bambuddy's test included, is accepted and dropped so Bambuddy reports
 * it delivered.
 */
export async function receiveBambuddyRequest(request: Request) {
  const invalid = serverMessages().server.prints.invalid
  const read = await readIngest(request, { maxBytes: MAX_PRINT_EVENT_BODY_BYTES, limiter: takeEvent, invalid })
  if (read instanceof Response) return read
  const event = bambuddyEventSchema.safeParse(read.json)
  if (!event.success) return ingestProblem(400, invalid)
  const report = bambuddyReport(event.data)
  if (report) await read.context.service.receivePrint(report)
  return new Response(null, { status: 204 })
}

/** Receives what the bridge read from Bambuddy that a print used per Spoolman spool; 404 until its print arrives. */
export async function receivePrintUsageRequest(request: Request) {
  const invalid = serverMessages().server.prints.invalidUsage
  const read = await readIngest(request, { maxBytes: MAX_PRINT_EVENT_BODY_BYTES, limiter: takeUsage, invalid })
  if (read instanceof Response) return read
  const usage = bambuddyUsageSchema.safeParse(read.json)
  if (!usage.success) return ingestProblem(400, invalid)
  await read.context.service.receivePrintUsage(usage.data)
  return new Response(null, { status: 204 })
}
