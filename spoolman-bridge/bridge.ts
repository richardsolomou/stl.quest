/**
 * Sends a Spoolman's spools to STL Quest. It listens to Spoolman's websocket, which reports every spool, filament, and
 * vendor change, and after each burst of changes and every few minutes it sends all spools if any changed, and on start
 * and reconnect always, so a missed event or a restart never leaves STL Quest behind. It also collects the spools STL
 * Quest queued to add, adds them to Spoolman, and reports each one back; and, given a Bambuddy, reads what each print
 * charged to which Spoolman spool and sends that too, along with the sliced file of each print STL Quest asks for. It only connects out: Spoolman and Bambuddy stay on the local
 * network, their addresses and keys stay here, and STL Quest receives with its ingest token. Node runs this file
 * directly, so it uses only erasable TypeScript.
 */

export type Config = {
  spoolmanUrl: string
  ingestUrl: string
  restocksUrl: string
  usageUrl: string
  slicedUrl: string
  token: string
  debounceMs: number
  resyncMs: number
  restockMs: number
  bambuddy?: { url: string; apiKey: string; pollMs: number }
}

type Environment = Record<string, string | undefined>

/** Spoolman's spool JSON, cut to what STL Quest reads. */
export type SlimSpool = {
  id: number
  remaining_weight?: number
  archived?: boolean
  filament: {
    id: number
    name?: string
    material?: string
    color_hex?: string
    external_id?: string
    vendor?: { name?: string }
  }
}

const KEEPALIVE_MS = 30_000
const MAX_BACKOFF_MS = 5 * 60_000

export function readConfig(environment: Environment): Config {
  const required = (name: string) => {
    const value = environment[name]?.trim()
    if (!value) throw new Error(`${name} is required`)
    return value
  }
  const spoolmanUrl = new URL(required('SPOOLMAN_URL'))
  const appUrl = new URL(required('STLQUEST_URL'))
  if (
    appUrl.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(appUrl.hostname) &&
    environment.STLQUEST_ALLOW_HTTP !== 'true'
  )
    throw new Error('STLQUEST_URL must use https, or set STLQUEST_ALLOW_HTTP=true for STL Quest on a trusted network')
  const seconds = (name: string, fallback: number) => {
    const value = Number(environment[name] ?? fallback)
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number of seconds`)
    return value * 1_000
  }
  const app = withoutTrailingSlash(appUrl.href)
  return {
    spoolmanUrl: withoutTrailingSlash(spoolmanUrl.href),
    ingestUrl: `${app}/api/spoolman/spools`,
    restocksUrl: `${app}/api/spoolman/restocks`,
    usageUrl: `${app}/api/bambuddy/usage`,
    slicedUrl: `${app}/api/bambuddy/sliced`,
    token: required('STLQUEST_TOKEN'),
    debounceMs: seconds('DEBOUNCE_SECONDS', 3),
    resyncMs: seconds('RESYNC_SECONDS', 15 * 60),
    restockMs: seconds('RESTOCK_SECONDS', 60),
    ...(environment.BAMBUDDY_URL?.trim() && {
      bambuddy: {
        url: withoutTrailingSlash(new URL(required('BAMBUDDY_URL')).href),
        apiKey: required('BAMBUDDY_API_KEY'),
        pollMs: seconds('BAMBUDDY_POLL_SECONDS', 60),
      },
    }),
  }
}

/** Spoolman's event socket for every resource, under the same base path as its API. */
export function websocketUrl(spoolmanUrl: string) {
  return `${spoolmanUrl.replace(/^http/, 'ws')}/api/v1/`
}

export function slimSpool(spool: SlimSpool): SlimSpool {
  const { filament } = spool
  return {
    id: spool.id,
    ...(typeof spool.remaining_weight === 'number' && { remaining_weight: spool.remaining_weight }),
    archived: spool.archived ?? false,
    filament: {
      id: filament.id,
      ...(filament.name && { name: filament.name }),
      ...(filament.material && { material: filament.material }),
      ...(filament.color_hex && { color_hex: filament.color_hex }),
      ...(filament.external_id && { external_id: filament.external_id }),
      ...(filament.vendor?.name && { vendor: { name: filament.vendor.name } }),
    },
  }
}

export async function fetchSpools(config: Config, fetcher: typeof fetch = fetch): Promise<SlimSpool[]> {
  const response = await fetcher(`${config.spoolmanUrl}/api/v1/spool?allow_archived=true`, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`Spoolman answered ${response.status}`)
  return ((await response.json()) as SlimSpool[]).map(slimSpool)
}

/**
 * Calls STL Quest with the token, posting `body` when there is one: JSON, or a stream of bytes. A status in `passed`
 * (404 by default) comes back for the caller to read; a refused token, a request to slow down, or any other failure
 * throws.
 */
async function stlQuest(
  config: Config,
  url: string,
  body: unknown,
  fetcher: typeof fetch,
  {
    method = body === undefined ? undefined : 'POST',
    passed = [404],
    timeoutMs = 30_000,
  }: { method?: string; passed?: number[]; timeoutMs?: number } = {},
) {
  const stream = body instanceof ReadableStream
  const response = await fetcher(url, {
    ...(method && { method }),
    headers: {
      authorization: `Bearer ${config.token}`,
      ...(body !== undefined && { 'content-type': stream ? 'application/octet-stream' : 'application/json' }),
    },
    ...(body !== undefined && { body: stream ? body : JSON.stringify(body) }),
    // Node sends a streamed body only half duplex.
    ...(stream && { duplex: 'half' }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (response.ok || passed.includes(response.status)) return response
  const reason = await response.text().catch(() => '')
  if (response.status === 401) throw new Error('STL Quest refused the token; create a new one under Settings → Spoolman')
  if (response.status === 429) throw new RetryLater(Number(response.headers.get('retry-after') ?? 60) * 1_000)
  throw new Error(`STL Quest answered ${response.status} ${reason}`.trim())
}

/** Sends every spool; throws `RetryLater` with how long to wait when STL Quest asked to slow down. */
export async function sendSpools(config: Config, spools: SlimSpool[], fetcher: typeof fetch = fetch) {
  const response = await stlQuest(config, config.ingestUrl, { spools }, fetcher)
  if (response.status === 404) throw new Error('STL Quest answered 404; check STLQUEST_URL')
}

/** A spool STL Quest queued, as Spoolman's `POST /api/v1/spool` takes it. */
export type Restock = { id: string; filament_id: number; initial_weight?: number; comment: string }
export type RestockResult = { id: string; spool_id: number } | { id: string; error: string }

/**
 * Adds a queued spool to Spoolman, unless a spool already carries its comment, which happens when the bridge added it
 * but STL Quest never heard back. Spoolman refusing it is reported; Spoolman being unreachable throws, to try later.
 */
export async function addRestock(
  config: Config,
  restock: Restock,
  spools: { id: number; comment?: string | null }[],
  fetcher: typeof fetch = fetch,
): Promise<RestockResult> {
  const added = spools.find(({ comment }) => comment?.includes(restock.comment))
  if (added) return { id: restock.id, spool_id: added.id }
  const { id, ...spool } = restock
  const response = await fetcher(`${config.spoolmanUrl}/api/v1/spool`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(spool),
    signal: AbortSignal.timeout(30_000),
  })
  if (response.ok) return { id, spool_id: ((await response.json()) as { id: number }).id }
  if (response.status < 400 || response.status >= 500) throw new Error(`Spoolman answered ${response.status}`)
  const refusal = (await response.json().catch(() => ({}))) as { message?: unknown; detail?: unknown }
  const reason = refusal.message ?? refusal.detail ?? `Spoolman answered ${response.status}`
  return { id, error: (typeof reason === 'string' ? reason : JSON.stringify(reason)).slice(0, 500) }
}

/** Adds every spool STL Quest has waiting to Spoolman and reports each; resolves to how many it handled. */
export async function syncRestocks(config: Config, fetcher: typeof fetch = fetch, log: Log = () => {}) {
  const { restocks } = (await (await stlQuest(config, config.restocksUrl, undefined, fetcher)).json()) as { restocks: Restock[] }
  if (!restocks.length) return 0
  const response = await fetcher(`${config.spoolmanUrl}/api/v1/spool?allow_archived=true`, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`Spoolman answered ${response.status}`)
  const spools = (await response.json()) as { id: number; comment?: string | null }[]
  for (const restock of restocks) {
    const result = await addRestock(config, restock, spools, fetcher)
    if ('spool_id' in result) {
      spools.push({ id: result.spool_id, comment: restock.comment })
      log(`added spool #${result.spool_id} to Spoolman for restock ${restock.id}`)
    } else log(`Spoolman refused restock ${restock.id}: ${result.error}`)
    // A 404 means the spool was removed in STL Quest meanwhile, which leaves nothing to report.
    await stlQuest(config, config.restocksUrl, result, fetcher)
  }
  return restocks.length
}

/** One print in Bambuddy's print log (`GET /api/v1/print-log/`), whose ID is the run ID its webhook sends. */
export type BambuddyRun = {
  id: number
  /** The archived file the run printed. */
  archive_id?: number | null
  /** Which plate of a file of several the run printed, 1-based. */
  plate_id?: number | null
  printer_id?: number | null
  print_name?: string | null
  status: string
  completed_at?: string | null
}
/** One charge in Bambuddy's usage history (`GET /api/v1/inventory/usage?spoolman=true`). */
export type BambuddyUsage = {
  spoolman_spool_id?: number | null
  printer_id?: number | null
  print_name?: string | null
  weight_used: number
  created_at: string
}
export type SpoolUsage = { spool_id: number; grams: number }

/** Bambuddy charges a print's spools as it ends, so a charge belongs to the run that ended nearest it within this. */
const CHARGE_WINDOW_MS = 10 * 60_000
/** A run STL Quest still has not received this long after it ended never will, so the bridge stops sending it. */
const GIVE_UP_MS = 60 * 60_000
/** Runs sent a poll at most, so a backlog goes over a few polls instead of all at once. */
const MAX_RUNS_PER_POLL = 10

/** Bambuddy writes UTC times without a zone. */
const utc = (time: string) => Date.parse(/(?:z|[+-]\d\d:?\d\d)$/i.test(time) ? time : `${time}Z`)

/**
 * What each run charged to each Spoolman spool. Bambuddy's usage history names no run, so a charge goes to the run on
 * the same printer, of the same print, that ended nearest it.
 */
export function runSpools(runs: BambuddyRun[], usage: BambuddyUsage[]) {
  const charged = new Map<string, Map<number, number>>()
  for (const charge of usage) {
    const spoolId = charge.spoolman_spool_id
    if (spoolId === null || spoolId === undefined || !(charge.weight_used > 0)) continue
    const at = utc(charge.created_at)
    const ended = runs
      .filter(
        (candidate) =>
          candidate.completed_at &&
          candidate.printer_id === charge.printer_id &&
          (!candidate.print_name || !charge.print_name || candidate.print_name === charge.print_name),
      )
      .map((candidate) => ({ candidate, gap: Math.abs(utc(candidate.completed_at!) - at) }))
      .filter(({ gap }) => gap <= CHARGE_WINDOW_MS)
      .sort((left, right) => left.gap - right.gap)[0]?.candidate
    if (!ended) continue
    const spools = charged.get(String(ended.id)) ?? new Map<number, number>()
    spools.set(spoolId, (spools.get(spoolId) ?? 0) + charge.weight_used)
    charged.set(String(ended.id), spools)
  }
  return new Map(
    [...charged].map(([runId, spools]) => [
      runId,
      [...spools].map(([spool_id, grams]): SpoolUsage => ({ spool_id, grams: Math.round(grams * 10) / 10 })),
    ]),
  )
}

/** Sends what a run charged to each spool; false when STL Quest has not received the run's print yet. */
export async function sendPrintUsage(config: Config, runId: string, spools: SpoolUsage[], fetcher: typeof fetch = fetch) {
  const response = await stlQuest(config, config.usageUrl, { run_id: runId, spools }, fetcher)
  return response.status !== 404
}

async function readBambuddy<Body>(bambuddy: NonNullable<Config['bambuddy']>, path: string, fetcher: typeof fetch) {
  const response = await fetcher(`${bambuddy.url}${path}`, {
    headers: { 'X-API-Key': bambuddy.apiKey },
    signal: AbortSignal.timeout(30_000),
  })
  if (response.status === 401 || response.status === 403)
    throw new Error('Bambuddy refused the API key; it needs read access to the print log and inventory')
  if (!response.ok) throw new Error(`Bambuddy answered ${response.status}`)
  return (await response.json()) as Body
}

/**
 * Sends each recent run's Spoolman spools that STL Quest has not been sent as they are now, skipping runs that ended
 * too long ago to wait for. `sent` remembers what went, by run, between polls.
 */
export async function syncPrints(
  config: Config,
  sent: Map<string, string>,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
  log: Log = () => {},
) {
  const { bambuddy } = config
  if (!bambuddy) return []
  const { items: runs } = await readBambuddy<{ items: BambuddyRun[] }>(bambuddy, '/api/v1/print-log/?limit=100', fetcher)
  const usage = await readBambuddy<BambuddyUsage[]>(bambuddy, '/api/v1/inventory/usage?spoolman=true&limit=500', fetcher)
  let posts = 0
  for (const [runId, spools] of runSpools(runs, usage)) {
    const sending = JSON.stringify(spools)
    if (sent.get(runId) === sending || now - utc(runs.find(({ id }) => String(id) === runId)!.completed_at!) > GIVE_UP_MS) continue
    if (posts++ === MAX_RUNS_PER_POLL) break
    if (await sendPrintUsage(config, runId, spools, fetcher)) {
      sent.set(runId, sending)
      const grams = Math.round(spools.reduce((total, spool) => total + spool.grams, 0) * 10) / 10
      log(`sent run ${runId} to STL Quest: ${grams} g from ${spools.length} spool${spools.length === 1 ? '' : 's'}`)
    } else log(`STL Quest has not received run ${runId} yet; sending it again next poll`)
  }
  const recent = new Set(runs.map(({ id }) => String(id)))
  for (const runId of sent.keys()) if (!recent.has(runId)) sent.delete(runId)
  return runs
}

/** The most a sliced file may be for STL Quest to take it, as `MAX_SLICED_FILE_BYTES` in STL Quest says. */
export const MAX_SLICED_FILE_BYTES = 64 * 1024 * 1024
const SERVER_ERRORS = Array.from({ length: 100 }, (_, index) => 500 + index)
/** Sliced files sent a poll at most; each can be tens of MB. */
const MAX_SLICED_PER_POLL = 3
/** Downloading a large file from Bambuddy and sending it on can take a while on a slow uplink. */
const SLICED_TIMEOUT_MS = 5 * 60_000

/**
 * Sends STL Quest the sliced file of each print it asks for, downloaded from Bambuddy's archive and streamed on as it
 * arrives. `runs` is Bambuddy's print log, which says which plate of the file each run printed. A file Bambuddy does
 * not have, or that is too large or that STL Quest cannot read, goes in `skipped` and is not tried again; STL Quest is
 * told it is unavailable, so it stops asking for it, unless it already refused the file itself.
 */
export async function sendSlicedFiles(
  config: Config,
  runs: BambuddyRun[],
  skipped: Set<string>,
  fetcher: typeof fetch = fetch,
  log: Log = () => {},
) {
  const { bambuddy } = config
  if (!bambuddy) return
  const asked = await stlQuest(config, config.slicedUrl, undefined, fetcher)
  // An STL Quest from before sliced files has no such endpoint.
  if (asked.status === 404) return
  const { runs: wanted } = (await asked.json()) as { runs: { run_id: string; archive_id?: string }[] }
  let sent = 0
  for (const { run_id: runId, archive_id: wantedArchive } of wanted) {
    if (skipped.has(runId)) continue
    if (sent++ === MAX_SLICED_PER_POLL) break
    const printed = runs.find(({ id }) => String(id) === runId)
    const archiveId = printed?.archive_id ?? wantedArchive
    const skip = async (reason: string, tell = true) => {
      skipped.add(runId)
      log(`not sending the sliced file of run ${runId}: ${reason}`)
      // An STL Quest from before this has no such method, and asks again until the run is a day old.
      if (tell)
        await stlQuest(config, `${config.slicedUrl}?${new URLSearchParams({ run_id: runId })}`, undefined, fetcher, {
          method: 'DELETE',
          passed: [404, 405],
        })
    }
    if (archiveId === undefined || archiveId === null) {
      await skip('Bambuddy archived no file for it')
      continue
    }
    const file = await fetcher(`${bambuddy.url}/api/v1/archives/${encodeURIComponent(String(archiveId))}/download`, {
      headers: { 'X-API-Key': bambuddy.apiKey },
      signal: AbortSignal.timeout(SLICED_TIMEOUT_MS),
    })
    if (file.status === 401 || file.status === 403)
      throw new Error('Bambuddy refused the API key; it needs Read Status, and its owner needs to see every archive')
    if (file.status === 404) {
      await skip('Bambuddy’s archive does not have it')
      continue
    }
    if (!file.ok || !file.body) throw new Error(`Bambuddy answered ${file.status}`)
    if (Number(file.headers.get('content-length')) > MAX_SLICED_FILE_BYTES) {
      await file.body.cancel()
      await skip(`it is larger than ${MAX_SLICED_FILE_BYTES / 1024 / 1024} MB`)
      continue
    }
    const query = new URLSearchParams({ run_id: runId, ...(printed?.plate_id && { plate: String(printed.plate_id) }) })
    const response = await stlQuest(config, `${config.slicedUrl}?${query}`, file.body, fetcher, {
      passed: [404, 413, 422, ...SERVER_ERRORS],
      timeoutMs: SLICED_TIMEOUT_MS,
    })
    if (response.ok) log(`sent the sliced file of run ${runId} to STL Quest`)
    else if (response.status === 404) log(`STL Quest has not received run ${runId} yet; sending its sliced file again next poll`)
    else if (response.status >= 500) {
      // One file failing must not hold back the runs after it.
      await response.body?.cancel()
      log(`STL Quest answered ${response.status} for the sliced file of run ${runId}; sending it again next poll`)
    } else await skip(await refusalOf(response), response.status !== 422)
  }
}

/** STL Quest's reason for refusing a request: its JSON `error`, else its text. */
async function refusalOf(response: Response) {
  const text = (await response.text().catch(() => '')).trim()
  try {
    const { error } = JSON.parse(text) as { error?: unknown }
    if (typeof error === 'string') return error
  } catch {}
  return text || `STL Quest answered ${response.status}`
}

type Log = (message: string) => void

export class RetryLater extends Error {
  readonly delayMs: number
  constructor(delayMs: number) {
    super(`STL Quest asked to wait ${Math.round(delayMs / 1_000)}s`)
    this.delayMs = delayMs
  }
}

/** Runs until the process stops: syncs on start, after changes settle, and on a timer, reconnecting with backoff. */
export function run(config: Config, log: Log = console.log) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let syncing = false
  let again = false
  let failures = 0
  let lastSent = ''

  const schedule = (delayMs: number) => {
    clearTimeout(timer)
    timer = setTimeout(() => void sync(), delayMs)
  }

  const sync = async (force = false) => {
    if (syncing) {
      again = true
      return
    }
    syncing = true
    try {
      const spools = await fetchSpools(config)
      const body = JSON.stringify(spools)
      if (force || body !== lastSent) {
        await sendSpools(config, spools)
        lastSent = body
        log(`sent ${spools.length} spools`)
      }
      failures = 0
      schedule(config.resyncMs)
    } catch (error) {
      failures += 1
      const delayMs = error instanceof RetryLater ? error.delayMs : Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** failures)
      log(`sync failed, retrying in ${Math.round(delayMs / 1_000)}s: ${error instanceof Error ? error.message : String(error)}`)
      schedule(delayMs)
    } finally {
      syncing = false
      if (again) {
        again = false
        schedule(config.debounceMs)
      }
    }
  }

  let socketFailures = 0
  const connect = () => {
    const socket = new WebSocket(websocketUrl(config.spoolmanUrl))
    // Spoolman answers any text with a health reply, which keeps proxies from closing an idle socket.
    const keepalive = setInterval(() => socket.readyState === WebSocket.OPEN && socket.send('ping'), KEEPALIVE_MS)
    socket.addEventListener('open', () => {
      socketFailures = 0
      log('listening to Spoolman')
      // Changes made while the socket was down were missed, so a full send catches up.
      void sync(true)
    })
    socket.addEventListener('message', (event) => {
      if (typeof event.data === 'string' && event.data.includes('"resource"')) schedule(config.debounceMs)
    })
    socket.addEventListener('close', () => {
      clearInterval(keepalive)
      socketFailures += 1
      const delayMs = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** socketFailures)
      log(`Spoolman connection closed, reconnecting in ${Math.round(delayMs / 1_000)}s`)
      setTimeout(connect, delayMs)
    })
    socket.addEventListener('error', () => socket.close())
  }

  connect()
  repeat('restocks', config.restockMs, () => syncRestocks(config, fetch, log), log)
  if (config.bambuddy) {
    const sent = new Map<string, string>()
    const skipped = new Set<string>()
    repeat(
      'Bambuddy',
      config.bambuddy.pollMs,
      async () => sendSlicedFiles(config, await syncPrints(config, sent, fetch, Date.now(), log), skipped, fetch, log),
      log,
    )
  }
}

/** Runs `task` now and every `everyMs`, backing off after failures and waiting as long as STL Quest asks. */
function repeat(name: string, everyMs: number, task: () => Promise<unknown>, log: Log) {
  let failures = 0
  const tick = async () => {
    let delayMs = everyMs
    try {
      await task()
      failures = 0
    } catch (error) {
      failures += 1
      delayMs = error instanceof RetryLater ? error.delayMs : Math.min(MAX_BACKOFF_MS, everyMs * 2 ** failures)
      log(`${name} failed, retrying in ${Math.round(delayMs / 1_000)}s: ${error instanceof Error ? error.message : String(error)}`)
    }
    setTimeout(() => void tick(), delayMs)
  }
  void tick()
}

function withoutTrailingSlash(url: string) {
  return url.replace(/\/+$/, '')
}

if (import.meta.main) {
  try {
    run(readConfig(process.env))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
