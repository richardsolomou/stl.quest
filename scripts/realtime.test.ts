import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  caddyfile,
  containerProcesses,
  developmentArguments,
  persistedSecret,
  runtimeImage,
  supervise,
  type RuntimeProcess,
} from './realtime'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('development Centrifugo', () => {
  const image = 'ghcr.io/example/runtime-binaries:runtime-v1.0.0@sha256:' + '0'.repeat(64)

  it('runs the pinned image on loopback with the development secret and the app’s origin', () => {
    const args = developmentArguments({}, '/work/my-app', image)
    expect(args).toEqual([
      'run',
      '--rm',
      '--name',
      'my-app-realtime',
      '-p',
      '127.0.0.1:8000:8000',
      '-e',
      'CENTRIFUGO_HTTP_API_KEY=stlquest-development-realtime-secret',
      '-e',
      'CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY=stlquest-development-realtime-secret',
      '-e',
      'CENTRIFUGO_CLIENT_SUBSCRIPTION_TOKEN_ENABLED=true',
      '-e',
      'CENTRIFUGO_CLIENT_SUBSCRIPTION_TOKEN_HMAC_SECRET_KEY=stlquest-development-realtime-secret',
      '-e',
      'CENTRIFUGO_CLIENT_ALLOWED_ORIGINS=http://localhost:3000',
      '-v',
      '/work/my-app/centrifugo.json:/centrifugo.json:ro',
      image,
      'centrifugo',
      '--config=/centrifugo.json',
    ])
  })

  it('reads the image from the Dockerfile’s runtime-binaries stage', () => {
    expect(runtimeImage(`FROM ${image} AS runtime-binaries\nFROM node:24-alpine AS build\n`)).toBe(image)
  })

  it('refuses a Dockerfile without a runtime-binaries stage', () => {
    expect(() => runtimeImage('FROM node:24-alpine AS build\n')).toThrow('runtime-binaries')
  })

  it('runs the image the application’s Dockerfile pins by digest', async () => {
    expect(runtimeImage(await readFile('Dockerfile', 'utf8'))).toMatch(/:runtime-v[\d.]+@sha256:[0-9a-f]{64}$/)
  })
})

describe('container processes', () => {
  const processes = containerProcesses({ APP_URL: 'https://app.example', PATH: '/bin' }, 'secret', '/tmp/caddy/Caddyfile')
  const byName = (name: RuntimeProcess['name']) => processes.find((process) => process.name === name)!

  it('keeps the app on loopback behind Caddy and hands it the secret', () => {
    expect(byName('app').env).toMatchObject({ NITRO_HOST: '127.0.0.1', NITRO_PORT: '3001', STLQUEST_REALTIME_SECRET: 'secret' })
  })

  it('gives the app one second to drain, since Caddy drains requests before the app is signalled', () => {
    expect(byName('app').env.SERVER_SHUTDOWN_TIMEOUT).toBe('1')
  })

  it('keeps Centrifugo on loopback and accepts only the app’s origin', () => {
    expect(byName('realtime').env).toMatchObject({
      CENTRIFUGO_HTTP_SERVER_ADDRESS: '127.0.0.1',
      CENTRIFUGO_HTTP_SERVER_PORT: '8000',
      CENTRIFUGO_CLIENT_ALLOWED_ORIGINS: 'https://app.example',
      CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY: 'secret',
    })
  })

  it('accepts the origin of an APP_URL written with a path', () => {
    const realtime = containerProcesses({ APP_URL: 'https://app.example/' }, 'secret', '/tmp/caddy/Caddyfile').find(
      (process) => process.name === 'realtime',
    )
    expect(realtime?.env.CENTRIFUGO_CLIENT_ALLOWED_ORIGINS).toBe('https://app.example')
  })

  it('accepts any origin without APP_URL, leaving Caddy to refuse a WebSocket from another host', () => {
    const realtime = containerProcesses({}, 'secret', '/tmp/caddy/Caddyfile').find((process) => process.name === 'realtime')
    expect(realtime?.env.CENTRIFUGO_CLIENT_ALLOWED_ORIGINS).toBe('*')
  })

  it('takes a separate API key when configured', () => {
    const realtime = containerProcesses({ STLQUEST_REALTIME_API_KEY: 'key' }, 'secret', '/tmp/caddy/Caddyfile').find(
      (process) => process.name === 'realtime',
    )
    expect(realtime?.env).toMatchObject({ CENTRIFUGO_HTTP_API_KEY: 'key', CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY: 'secret' })
  })

  it('shares Centrifugo state through Redis in distributed mode', () => {
    const realtime = containerProcesses(
      { STLQUEST_DISTRIBUTED: 'true', REDIS_URL: 'redis://redis:6379' },
      'secret',
      '/tmp/caddy/Caddyfile',
    ).find((process) => process.name === 'realtime')
    expect(realtime?.env).toMatchObject({ CENTRIFUGO_ENGINE_TYPE: 'redis', CENTRIFUGO_ENGINE_REDIS_ADDRESS: 'redis://redis:6379' })
  })

  it('requires Redis in distributed mode', () => {
    expect(() => containerProcesses({ STLQUEST_DISTRIBUTED: 'true' }, 'secret', '/tmp/caddy/Caddyfile')).toThrow('REDIS_URL is required')
  })

  it('gives Caddy writable state directories', () => {
    expect(byName('proxy')).toMatchObject({
      args: ['run', '--config', '/tmp/caddy/Caddyfile', '--adapter', 'caddyfile'],
      env: { XDG_CONFIG_HOME: '/tmp/caddy/config', XDG_DATA_HOME: '/tmp/caddy/data' },
    })
  })
})

describe('Caddy configuration', () => {
  const config = caddyfile(3000)

  it('routes WebSockets to Centrifugo and everything else to the app', () => {
    expect([
      config.includes('@realtime path /connection/*\n\t\thandle @realtime {\n\t\t\treverse_proxy 127.0.0.1:8000'),
      config.includes('reverse_proxy 127.0.0.1:3001'),
    ]).toEqual([true, true])
  })

  it('routes WebSockets under the base path to Centrifugo without it', () => {
    expect(caddyfile(3000, '/stlquest')).toContain(
      '@realtime path /connection/* /stlquest/connection/*\n\t\thandle @realtime {\n\t\t\turi strip_prefix /stlquest\n',
    )
  })

  it('refuses WebSockets under the base path opened from another origin', () => {
    expect(caddyfile(3000, '/stlquest')).toContain("{path}.startsWith('/stlquest/connection/')")
  })

  it('stops waiting for requests after three seconds, so the app still gets its turn before the deadline', () => {
    expect(config).toMatch(/^\tgrace_period 3s$/m)
  })

  it('hands the app only the visitor’s address in X-Forwarded-For', () => {
    expect(config).toContain('reverse_proxy 127.0.0.1:3001 {\n\t\t\t\theader_up X-Forwarded-For {client_ip}\n')
  })

  it('refuses WebSockets opened from another origin', () => {
    expect(config).toContain('respond @foreignWebSocketOrigin 403')
  })

  it('listens on the public port', () => {
    expect(caddyfile(8080)).toContain(':8080 {')
  })
})

describe('persisted secret', () => {
  it('generates the secret once and reads it back', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'realtime-secret-'))
    const file = join(directory, 'nested', 'realtime-secret')
    const secret = persistedSecret({}, file)
    expect([secret, persistedSecret({}, file), await readFile(file, 'utf8')]).toEqual([secret, secret, secret])
    expect(secret).toMatch(/^[\w-]{64}$/)
    await rm(directory, { recursive: true })
  })

  it('prefers a configured secret', () => {
    expect(persistedSecret({ STLQUEST_REALTIME_SECRET: 'configured' }, '/nonexistent/realtime-secret')).toBe('configured')
  })
})

describe('supervisor', () => {
  it('stops the proxy, then the app, then Centrifugo on a signal', async () => {
    const { children, signals, status } = start()
    const order: string[] = []
    for (const [name, child] of Object.entries(children)) child.kill.mockImplementation(() => (order.push(name), true))
    signals.emit('SIGTERM')
    await vi.waitFor(() => expect(order).toEqual(['proxy']))
    children.proxy.exit(0)
    await vi.waitFor(() => expect(order).toEqual(['proxy', 'app']))
    children.app.exit(0)
    await vi.waitFor(() => expect(order).toEqual(['proxy', 'app', 'realtime']))
    children.realtime.exit(0)
    await expect(status).resolves.toBe(0)
  })

  it('kills everything when a shutdown phase overruns the shared deadline', async () => {
    vi.useFakeTimers()
    const { children, signals, status } = start(10)
    signals.emit('SIGTERM')
    await vi.advanceTimersByTimeAsync(10)
    await expect(status).resolves.toBe(0)
    expect(Object.values(children).map((child) => child.kill.mock.lastCall)).toEqual([['SIGKILL'], ['SIGKILL'], ['SIGKILL']])
  })

  it('stops the others at once when one exits unexpectedly, keeping its status', async () => {
    const { children, status } = start()
    children.app.exit(2)
    await vi.waitFor(() =>
      expect([children.realtime.kill.mock.lastCall, children.proxy.kill.mock.lastCall]).toEqual([['SIGTERM'], ['SIGTERM']]),
    )
    children.realtime.exit(0)
    children.proxy.exit(0)
    await expect(status).resolves.toBe(2)
  })

  it('kills the others when they outlive the deadline after an unexpected exit', async () => {
    vi.useFakeTimers()
    const { children, status } = start(10)
    children.app.exit(2)
    await vi.advanceTimersByTimeAsync(10)
    await expect(status).resolves.toBe(2)
    expect([children.realtime.kill.mock.lastCall, children.proxy.kill.mock.lastCall]).toEqual([['SIGKILL'], ['SIGKILL']])
  })
})

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { exitCode: number | null; signalCode: NodeJS.Signals | null }
  child.exitCode = null
  child.signalCode = null
  const kill = vi.fn((_signal?: NodeJS.Signals) => true)
  const exit = (code: number) => {
    child.exitCode = code
    child.emit('exit', code, null)
  }
  return { process: Object.assign(child, { kill }) as unknown as ChildProcess, kill, exit }
}

function start(timeoutMs = 10_000) {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const signals = new EventEmitter() as EventEmitter & Pick<NodeJS.Process, 'once' | 'off'>
  const children = { app: fakeChild(), realtime: fakeChild(), proxy: fakeChild() }
  const processes = (['app', 'realtime', 'proxy'] as const).map((name) => ({ name, command: name, args: [], env: {} }))
  const status = supervise(processes, {
    signals,
    spawnProcess: ({ name }) => children[name].process,
    timeoutMs,
  })
  return { children, signals, status }
}
