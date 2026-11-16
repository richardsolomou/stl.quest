import { beforeEach, describe, expect, it, vi } from 'vitest'
import { observeRpc, OptionalPostHogTelemetry, setRpcTelemetry, withTelemetryContext } from './optionalTelemetry'

const { capture, captureException, log, observe, shutdown, construct } = vi.hoisted(() => ({
  capture: vi.fn(),
  captureException: vi.fn(),
  log: vi.fn(),
  observe: vi.fn(async (_telemetry: unknown, _request: Request | undefined, work: () => Promise<unknown>) => work()),
  shutdown: vi.fn(async () => undefined),
  construct: vi.fn(),
}))

vi.mock('./telemetry', () => ({
  createTelemetry: (env: Record<string, string | undefined>, options?: unknown) => {
    construct(env, options)
    return { posthog: { capture, captureException }, log, shutdown }
  },
}))
vi.mock('./rpcTelemetry', () => ({ observeServerFunction: observe }))

describe('OptionalPostHogTelemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setRpcTelemetry(undefined)
    vi.stubEnv('VITE_POSTHOG_PROJECT_TOKEN', 'test-token')
  })

  it('reports the release version on server telemetry', () => {
    expect(new OptionalPostHogTelemetry(() => true)).toBeInstanceOf(OptionalPostHogTelemetry)
    expect(construct).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ serviceVersion: expect.any(String) }))
  })

  it('activates server function telemetry only while an application owns it', async () => {
    const telemetry = new OptionalPostHogTelemetry(() => true)
    const request = new Request('https://stl.quest/action', { method: 'POST' })

    await expect(observeRpc(request, async () => 'before')).resolves.toBe('before')
    setRpcTelemetry(telemetry)
    await expect(observeRpc(request, async () => 'active')).resolves.toBe('active')
    setRpcTelemetry(undefined)
    await expect(observeRpc(request, async () => 'after')).resolves.toBe('after')

    expect(observe).toHaveBeenCalledOnce()
  })

  it('adds the application context to product events and shuts down', async () => {
    const telemetry = new OptionalPostHogTelemetry(() => true, { app_version: '1.2.3', deployment_type: 'hosted' })
    await telemetry.capture('person', 'request_created', { count: 2 })
    await telemetry.shutdown()
    expect(capture).toHaveBeenCalledWith({
      distinctId: 'person',
      event: 'request_created',
      properties: { count: 2, app_version: '1.2.3', deployment_type: 'hosted' },
    })
    expect(shutdown).toHaveBeenCalledOnce()
  })

  it('adds workspace context without changing exception reporting', async () => {
    const telemetry = new OptionalPostHogTelemetry(() => true)
    const workspaceTelemetry = withTelemetryContext(telemetry, { workspace_id: 'anonymous-workspace' })
    const failure = new Error('unavailable')

    await workspaceTelemetry.capture('person', 'request_created', { print_type: 'resin' })
    await workspaceTelemetry.exception(failure, { action: 'create_request' })

    expect(capture).toHaveBeenCalledWith({
      distinctId: 'person',
      event: 'request_created',
      properties: { print_type: 'resin', workspace_id: 'anonymous-workspace' },
    })
    expect(captureException).toHaveBeenCalledWith(failure, undefined, { action: 'create_request' })
  })

  it('checks the telemetry setting for every event', async () => {
    let enabled = true
    const telemetry = new OptionalPostHogTelemetry(() => enabled)
    await telemetry.capture('first', 'request_created')
    enabled = false
    await telemetry.capture('second', 'request_created')
    enabled = true
    await telemetry.capture('third', 'request_created')
    expect(capture).toHaveBeenCalledTimes(2)
  })

  it('correlates server exceptions with request identity and session', async () => {
    const telemetry = new OptionalPostHogTelemetry(() => true)
    const failure = new Error('database unavailable')
    await telemetry.exception(failure, { action: 'sign_in', posthogDistinctId: 'person', sessionId: 'session' })
    expect(captureException).toHaveBeenCalledWith(failure, 'person', { action: 'sign_in', $session_id: 'session' })
  })

  it('maps structured Pino records to PostHog logs', async () => {
    const telemetry = new OptionalPostHogTelemetry(() => true)
    await telemetry.log({ level: 50, time: 1_234, msg: 'request failed', request_id: 'request-id', err: { type: 'Error' } })
    expect(log).toHaveBeenCalledWith('error', 'request failed', { request_id: 'request-id', err: { type: 'Error' } })
  })

  it('creates no PostHog client for a deployment with telemetry off', async () => {
    const telemetry = new OptionalPostHogTelemetry(() => false)
    await telemetry.capture('person', 'request_created')
    expect([construct.mock.calls[0]?.[0], capture.mock.calls.length]).toEqual([{ NODE_ENV: 'test' }, 0])
  })
})
