// Runs with Node's own type stripping (`node scripts/realtime.ts`), so it imports only Node built-ins and uses erasable syntax.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** The image of the Dockerfile's `runtime-binaries` stage, the one pin Dependabot updates for development and production. */
export function runtimeImage(dockerfile: string) {
  const image = /^FROM\s+(\S+)\s+AS\s+runtime-binaries\s*$/im.exec(dockerfile)?.[1]
  if (!image) throw new Error('The Dockerfile has no `FROM <image> AS runtime-binaries` stage')
  return image
}
// The same value as the development fallback in `src/server/realtime.ts`.
const developmentSecret = 'stlquest-development-realtime-secret'
const appPort = 3001
const realtimePort = 8000
// Docker sends SIGKILL ten seconds after SIGTERM. Caddy drains requests for up to 3 s, the app then gets 1 s for leftovers
// plus its own resource deadlines (realtime 1 s, telemetry 2 s), and Centrifugo stops last, all inside one 8 s deadline.
const shutdownTimeoutMs = 8_000
const caddyGracePeriod = '3s'
const appDrainSeconds = '1'

/** Centrifugo's settings that carry secrets or depend on the deployment; the rest live in `centrifugo.json`. */
export function centrifugoEnvironment(secret: string, allowedOrigins: string, apiKey = secret): NodeJS.ProcessEnv {
  return {
    CENTRIFUGO_HTTP_API_KEY: apiKey,
    CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY: secret,
    CENTRIFUGO_CLIENT_SUBSCRIPTION_TOKEN_ENABLED: 'true',
    CENTRIFUGO_CLIENT_SUBSCRIPTION_TOKEN_HMAC_SECRET_KEY: secret,
    CENTRIFUGO_CLIENT_ALLOWED_ORIGINS: allowedOrigins,
  }
}

// Centrifugo compares the browser's `Origin` exactly, so a trailing slash or path in `APP_URL` would refuse every WebSocket.
function allowedOrigin(environment: NodeJS.ProcessEnv) {
  const url = environment.APP_URL?.trim()
  return url ? new URL(url).origin : undefined
}

/** `docker run` arguments for the pinned Centrifugo, published on loopback only, for `vite dev` to proxy to. */
export function developmentArguments(environment: NodeJS.ProcessEnv, directory: string, image: string) {
  const secret = environment.STLQUEST_REALTIME_SECRET?.trim() || developmentSecret
  const settings = centrifugoEnvironment(secret, allowedOrigin(environment) ?? 'http://localhost:3000')
  return [
    'run',
    '--rm',
    '--name',
    `${path.basename(directory)}-realtime`,
    '-p',
    `127.0.0.1:${realtimePort}:${realtimePort}`,
    ...Object.entries(settings).flatMap(([name, value]) => ['-e', `${name}=${value}`]),
    '-v',
    `${path.join(directory, 'centrifugo.json')}:/centrifugo.json:ro`,
    image,
    'centrifugo',
    '--config=/centrifugo.json',
  ]
}

// The app validates `BASE_PATH` and refuses to start with an invalid one; this script runs without the app's modules.
function configuredBasePath(environment: NodeJS.ProcessEnv) {
  const trimmed = environment.BASE_PATH?.trim().replace(/^\/+|\/+$/g, '')
  return trimmed ? `/${trimmed}` : ''
}

/**
 * Caddy in front of the app and Centrifugo. The app gets the visitor's address as a single-value `X-Forwarded-For`, which
 * Better Auth trusts for rate limits; Caddy's default appends Traefik's address, and Better Auth then trusts neither.
 */
export function caddyfile(publicPort: number, basePath = '') {
  const prefixes = basePath ? ['', basePath] : ['']
  const realtimePaths = prefixes.map((prefix) => `${prefix}/connection/*`).join(' ')
  const realtimeRequest = prefixes.map((prefix) => `{path}.startsWith('${prefix}/connection/')`).join(' || ')
  return `{
\tgrace_period ${caddyGracePeriod}
\tservers {
\t\ttrusted_proxies static private_ranges
\t\ttrusted_proxies_strict
\t}
}

:${publicPort} {
\tencode zstd gzip
\troute {
\t\t@foreignWebSocketOrigin \`(${realtimeRequest}) && {http.request.header.Origin} != '' && {http.request.header.Origin} != 'http://' + {http.request.hostport} && {http.request.header.Origin} != 'https://' + {http.request.hostport}\`
\t\trespond @foreignWebSocketOrigin 403

\t\t@realtime path ${realtimePaths}
\t\thandle @realtime {
${basePath ? `\t\t\turi strip_prefix ${basePath}\n` : ''}\t\t\treverse_proxy 127.0.0.1:${realtimePort}
\t\t}

\t\thandle {
\t\t\treverse_proxy 127.0.0.1:${appPort} {
\t\t\t\theader_up X-Forwarded-For {client_ip}
\t\t\t}
\t\t}
\t}
}
`
}

/** The secret from `STLQUEST_REALTIME_SECRET`, or one generated once into `file`, so redeploys keep connections and tokens valid. */
export function persistedSecret(environment: NodeJS.ProcessEnv, file: string) {
  const configured = environment.STLQUEST_REALTIME_SECRET?.trim()
  if (configured) return configured
  try {
    return readSecret(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, crypto.randomBytes(48).toString('base64url'), { mode: 0o600, flag: 'wx' })
    // A hard link fails if another process created the file first, so both end up with the same secret.
    fs.linkSync(temporary, file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  } finally {
    fs.rmSync(temporary, { force: true })
  }
  return readSecret(file)
}

function readSecret(file: string) {
  const secret = fs.readFileSync(file, 'utf8').trim()
  if (!secret) throw new Error(`realtime secret file is empty: ${file}`)
  return secret
}

export type RuntimeProcess = { name: 'proxy' | 'app' | 'realtime'; command: string; args: string[]; env: NodeJS.ProcessEnv }

/** Caddy stops taking traffic first, then the app finishes its requests and publications while Centrifugo still runs. */
const shutdownOrder: RuntimeProcess['name'][] = ['proxy', 'app', 'realtime']

/** Distributed replicas share Centrifugo's state through Redis, so a publication on one reaches browsers on every other. */
function centrifugoEngine(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (environment.STLQUEST_DISTRIBUTED !== 'true') return {}
  const url = environment.REDIS_URL?.trim()
  if (!url) throw new Error('REDIS_URL is required in distributed mode')
  return { CENTRIFUGO_ENGINE_TYPE: 'redis', CENTRIFUGO_ENGINE_REDIS_ADDRESS: url }
}

/** The container's three processes: Caddy in front, the app and Centrifugo on loopback behind it. */
export function containerProcesses(environment: NodeJS.ProcessEnv, secret: string, caddyConfig: string): RuntimeProcess[] {
  const apiKey = environment.STLQUEST_REALTIME_API_KEY?.trim() || secret
  return [
    {
      name: 'app',
      command: process.execPath,
      args: ['.output/server/index.mjs'],
      env: {
        ...environment,
        STLQUEST_REALTIME_SECRET: secret,
        NITRO_HOST: '127.0.0.1',
        NITRO_PORT: String(appPort),
        // Caddy has already drained requests by the time the app is signalled.
        SERVER_SHUTDOWN_TIMEOUT: appDrainSeconds,
      },
    },
    {
      name: 'realtime',
      command: 'centrifugo',
      args: ['--config=centrifugo.json'],
      env: {
        ...environment,
        ...centrifugoEnvironment(secret, allowedOrigin(environment) ?? '*', apiKey),
        ...centrifugoEngine(environment),
        CENTRIFUGO_HTTP_SERVER_ADDRESS: '127.0.0.1',
        CENTRIFUGO_HTTP_SERVER_PORT: String(realtimePort),
      },
    },
    {
      name: 'proxy',
      command: 'caddy',
      args: ['run', '--config', caddyConfig, '--adapter', 'caddyfile'],
      env: { ...environment, XDG_CONFIG_HOME: '/tmp/caddy/config', XDG_DATA_HOME: '/tmp/caddy/data' },
    },
  ]
}

type Signals = Pick<NodeJS.Process, 'once' | 'off'>
type Spawn = (process: RuntimeProcess) => ChildProcess

/**
 * Runs the processes until one exits or a signal arrives, and resolves with the exit status. A signal stops them one at a
 * time in `shutdownOrder` within one shared deadline; an unexpected exit stops the rest at once. Anything still running at
 * the deadline is killed.
 */
export function supervise(
  processes: RuntimeProcess[],
  {
    signals = process,
    spawnProcess = spawnInherited,
    timeoutMs = shutdownTimeoutMs,
  }: { signals?: Signals; spawnProcess?: Spawn; timeoutMs?: number } = {},
) {
  const children = new Map<RuntimeProcess['name'], { child: ChildProcess; exited: Promise<void> }>()
  let tearingDown = false
  let stopping = false
  let expectedExit: ChildProcess | undefined
  let resolveStatus!: (status: number) => void
  const status = new Promise<number>((resolve) => (resolveStatus = resolve))
  const running = () => [...children.values()].filter(({ child }) => child.exitCode === null && child.signalCode === null)

  const finish = (code: number) => {
    signals.off('SIGINT', onSignal)
    signals.off('SIGTERM', onSignal)
    resolveStatus(code)
  }
  const stopAll = async (code: number) => {
    if (tearingDown) return
    tearingDown = true
    const remaining = running()
    for (const { child } of remaining) child.kill('SIGTERM')
    if (!(await before(Promise.all(remaining.map(({ exited }) => exited)), timeoutMs))) {
      for (const { child } of running()) child.kill('SIGKILL')
    }
    finish(code)
  }
  const stopInOrder = async () => {
    if (tearingDown || stopping) return
    stopping = true
    const deadline = Date.now() + timeoutMs
    for (const name of shutdownOrder) {
      const entry = children.get(name)
      if (!entry || entry.child.exitCode !== null || entry.child.signalCode !== null) continue
      expectedExit = entry.child
      entry.child.kill('SIGTERM')
      const exited = await before(entry.exited, Math.max(0, deadline - Date.now()))
      expectedExit = undefined
      if (tearingDown) return
      if (!exited) {
        for (const { child } of running()) child.kill('SIGKILL')
        break
      }
    }
    tearingDown = true
    finish(0)
  }
  const onSignal = () => void stopInOrder()
  signals.once('SIGINT', onSignal)
  signals.once('SIGTERM', onSignal)

  for (const specification of processes) {
    const child = spawnProcess(specification)
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    children.set(specification.name, { child, exited })
    child.once('error', (error) => {
      console.error({ event: 'runtime_process_failed', process: specification.name, error })
      void stopAll(1)
    })
    child.once('exit', (code) => {
      if (child === expectedExit || tearingDown) return
      console.error({ event: 'runtime_process_exited', process: specification.name, code })
      void stopAll(code && code > 0 ? code : 1)
    })
  }
  return status
}

function spawnInherited({ command, args, env }: RuntimeProcess) {
  return spawn(command, args, { env, stdio: 'inherit' })
}

async function before(work: Promise<unknown>, timeoutMs: number) {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), timeoutMs)))
  try {
    return await Promise.race([work.then(() => true as const), timeout])
  } finally {
    clearTimeout(timer)
  }
}

if (import.meta.main) {
  const command = process.argv[2]
  if (command === 'dev') {
    const child = spawn('docker', developmentArguments(process.env, process.cwd(), runtimeImage(fs.readFileSync('Dockerfile', 'utf8'))), {
      stdio: 'inherit',
    })
    child.once('error', (error) => {
      console.error((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'Docker is required to run Centrifugo in development' : error)
      process.exitCode = 1
    })
    child.once('exit', (code) => (process.exitCode = code ?? 1))
  } else if (command === 'container') {
    const secretFile =
      process.env.STLQUEST_REALTIME_SECRET_FILE?.trim() || path.join(process.env.DATA_DIR?.trim() || '/data', 'realtime-secret')
    const secret = persistedSecret(process.env, secretFile)
    // A preview starts from a seeded workspace and account, written before the app opens the database.
    if (process.env.STLQUEST_SEED_PREVIEW === 'true')
      execFileSync(process.execPath, ['.output/server/seed-preview.mjs'], { stdio: 'inherit' })
    const config = '/tmp/caddy/Caddyfile'
    fs.mkdirSync(path.dirname(config), { recursive: true })
    fs.writeFileSync(config, caddyfile(Number(process.env.PORT?.trim() || 3000), configuredBasePath(process.env)))
    process.exitCode = await supervise(containerProcesses(process.env, secret, config))
  } else {
    console.error('usage: node scripts/realtime.ts dev | container')
    process.exitCode = 2
  }
}
