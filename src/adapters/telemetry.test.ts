import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OptionalPostHogTelemetry } from './telemetry'

const { capture, exception, log, shutdown, start, construct } = vi.hoisted(() => ({
  capture: vi.fn(async () => undefined),
  exception: vi.fn(async () => undefined),
  log: vi.fn(async () => undefined),
  shutdown: vi.fn(async () => undefined),
  start: vi.fn(async () => undefined),
  construct: vi.fn(),
}))

vi.mock('ras-stack/posthog/server', () => ({
  createManagedPostHogServerTelemetry: (options: unknown) => {
    construct(options)
    return { capture, exception, log, shutdown, start }
  },
}))

describe('OptionalPostHogTelemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.VITE_POSTHOG_PROJECT_TOKEN = 'test-token'
    process.env.VITE_POSTHOG_HOST = 'https://posthog.test'
  })

  it('delegates its lifecycle and product events to managed telemetry', async () => {
    const telemetry = new OptionalPostHogTelemetry(() => true)
    await telemetry.start()
    await telemetry.capture('person', 'request_created', { count: 2 })
    await telemetry.shutdown()
    expect(start).toHaveBeenCalledOnce()
    expect(capture).toHaveBeenCalledWith('person', 'request_created', { count: 2 })
    expect(shutdown).toHaveBeenCalledOnce()
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
    expect(exception).toHaveBeenCalledWith(failure, 'person', { action: 'sign_in', $session_id: 'session' })
  })

  it('maps structured Pino records to managed logs', async () => {
    const telemetry = new OptionalPostHogTelemetry(() => true)
    await telemetry.log({ level: 50, time: 1_234, msg: 'request failed', request_id: 'request-id', err: { type: 'Error' } })
    expect(log).toHaveBeenCalledWith({
      body: 'request failed',
      timestamp: 1_234,
      severityText: 'error',
      attributes: { request_id: 'request-id', err: { type: 'Error' } },
    })
  })

  it('constructs a managed lifecycle while leaving capture disabled', async () => {
    const telemetry = new OptionalPostHogTelemetry(() => false)
    await telemetry.capture('person', 'request_created')
    expect(construct).toHaveBeenCalledWith(
      expect.objectContaining({ clientOptions: { enableExceptionAutocapture: false }, serviceName: 'stlquest' }),
    )
    expect(capture).not.toHaveBeenCalled()
  })
})
