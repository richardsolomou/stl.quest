import { bambuddyReport, MAX_PRINT_EVENT_BODY_BYTES, MAX_SLICED_FILE_BYTES } from '../core/printJobs'
import { ingestProblem, ingestWorkspace, readIngest, readIngestBytes } from './ingest'
import { serverMessages } from './locale'
import { fixedWindowLimiter } from './rateLimit'
import { bambuddyEventSchema, bambuddySlicedFileSchema, bambuddyUsageSchema } from './schemas'

/** Bambuddy sends a few notifications per print, so this leaves room for a farm of printers finishing together. */
const takeEvent = fixedWindowLimiter(60, 60_000)
/** The bridge's own allowance, so however much it sends, Bambuddy's notifications are never refused for it. */
const takeUsage = fixedWindowLimiter(60, 60_000)
/** The bridge asks once a poll and sends a few files, each up to tens of MB, so sliced files have a tight allowance of their own. */
const takeSliced = fixedWindowLimiter(20, 60_000)

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

/**
 * Names the ended prints of plate runs whose sliced file the bridge should fetch from Bambuddy's archive, by run and
 * archive ID. This is all it reads back: IDs Bambuddy itself sent.
 */
export async function sendSlicedFilesWanted(request: Request) {
  const context = await ingestWorkspace(request, takeSliced)
  if (context instanceof Response) return context
  const wanted = await context.service.slicedFilesWanted()
  return Response.json(
    { runs: wanted.map(({ runId, archiveId }) => ({ run_id: runId, ...(archiveId && { archive_id: archiveId }) })) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

/** Receives a print's sliced `.gcode.3mf`, which the bridge streams from Bambuddy's archive; 404 until its print arrives. */
export async function receiveSlicedFileRequest(request: Request) {
  const invalid = serverMessages().server.prints.invalidSlicedFile
  const query = bambuddySlicedFileSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  const read = await readIngestBytes(request, {
    maxBytes: MAX_SLICED_FILE_BYTES,
    limiter: takeSliced,
    invalid,
    contentType: /^application\/octet-stream\b/i,
  })
  if (read instanceof Response) return read
  if (!query.success) return ingestProblem(400, invalid)
  const { assetQueue, service } = read.context
  await service.receivePrintSlicedFile(query.data, (stoppedAt) => assetQueue.readSlicedFile(read.body, stoppedAt))
  return new Response(null, { status: 204 })
}

/** Takes in that the bridge cannot get a print's sliced file from Bambuddy, or not one STL Quest takes; 404 until its print arrives. */
export async function slicedFileUnavailableRequest(request: Request) {
  const context = await ingestWorkspace(request, takeSliced)
  if (context instanceof Response) return context
  const query = bambuddySlicedFileSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!query.success) return ingestProblem(400, serverMessages().server.prints.invalidSlicedFile)
  await context.service.slicedFileUnavailable(query.data.runId)
  return new Response(null, { status: 204 })
}
