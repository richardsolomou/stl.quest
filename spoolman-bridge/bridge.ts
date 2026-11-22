/**
 * Sends a Spoolman's spools to STL Quest. It listens to Spoolman's websocket, which reports every spool, filament, and
 * vendor change, and after each burst of changes and every few minutes it sends all spools if any changed, and on start
 * and reconnect always, so a missed event or a restart never leaves STL Quest behind. It only connects out: Spoolman stays on the local network, and
 * STL Quest receives with a write-only token. Node runs this file directly, so it uses only erasable TypeScript.
 */

export type Config = {
  spoolmanUrl: string
  ingestUrl: string
  token: string
  debounceMs: number
  resyncMs: number
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
  return {
    spoolmanUrl: withoutTrailingSlash(spoolmanUrl.href),
    ingestUrl: `${withoutTrailingSlash(appUrl.href)}/api/spoolman/spools`,
    token: required('STLQUEST_TOKEN'),
    debounceMs: seconds('DEBOUNCE_SECONDS', 3),
    resyncMs: seconds('RESYNC_SECONDS', 15 * 60),
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

/** Sends every spool; resolves to how long to wait before the next send when STL Quest asked to slow down. */
export async function sendSpools(config: Config, spools: SlimSpool[], fetcher: typeof fetch = fetch) {
  const response = await fetcher(config.ingestUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ spools }),
    signal: AbortSignal.timeout(30_000),
  })
  if (response.ok) return
  const reason = await response.text().catch(() => '')
  if (response.status === 401) throw new Error('STL Quest refused the token; create a new one under Settings → Spoolman')
  if (response.status === 429) throw new RetryLater(Number(response.headers.get('retry-after') ?? 60) * 1_000)
  throw new Error(`STL Quest answered ${response.status} ${reason}`.trim())
}

export class RetryLater extends Error {
  readonly delayMs: number
  constructor(delayMs: number) {
    super(`STL Quest asked to wait ${Math.round(delayMs / 1_000)}s`)
    this.delayMs = delayMs
  }
}

/** Runs until the process stops: syncs on start, after changes settle, and on a timer, reconnecting with backoff. */
export function run(config: Config, log: (message: string) => void = console.log) {
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
