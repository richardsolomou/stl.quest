import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OptionalPostHogTelemetry } from './telemetry'

const { capture, shutdown, construct } = vi.hoisted(() => ({
  capture: vi.fn(),
  shutdown: vi.fn(async () => undefined),
  construct: vi.fn(),
}))

vi.mock('posthog-node', () => ({
  PostHog: class {
    capture = capture
    shutdown = shutdown

    constructor(...args: unknown[]) {
      construct(...args)
    }
  },
}))

describe('OptionalPostHogTelemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.VITE_POSTHOG_PROJECT_TOKEN = 'test-token'
    process.env.VITE_POSTHOG_HOST = 'https://posthog.test'
  })

  it('reuses one client while checking the enabled setting for each event', async () => {
    let enabled = true
    const telemetry = new OptionalPostHogTelemetry(() => enabled)

    await telemetry.capture('first', 'request_created')
    enabled = false
    await telemetry.capture('second', 'request_created')
    enabled = true
    await telemetry.capture('third', 'request_created')

    expect(construct).toHaveBeenCalledOnce()
    expect(construct).toHaveBeenCalledWith('test-token', {
      host: 'https://posthog.test',
      flushAt: 1,
      flushInterval: 0,
      enableExceptionAutocapture: true,
    })
    expect(capture).toHaveBeenCalledTimes(2)
  })

  it('shuts down the client once and ignores later captures', async () => {
    const telemetry = new OptionalPostHogTelemetry(() => true)
    await telemetry.capture('first', 'request_created')

    await telemetry.shutdown()
    await telemetry.shutdown()
    await telemetry.capture('second', 'request_created')

    expect(shutdown).toHaveBeenCalledOnce()
    expect(capture).toHaveBeenCalledOnce()
  })

  it('does not construct a client when telemetry remains disabled', async () => {
    const telemetry = new OptionalPostHogTelemetry(() => false)

    await telemetry.capture('first', 'request_created')
    await telemetry.shutdown()

    expect(construct).not.toHaveBeenCalled()
    expect(shutdown).not.toHaveBeenCalled()
  })

  it('silently no-ops when the PostHog environment variables are unset', async () => {
    delete process.env.VITE_POSTHOG_PROJECT_TOKEN
    delete process.env.VITE_POSTHOG_HOST
    const telemetry = new OptionalPostHogTelemetry(() => true)

    await telemetry.capture('first', 'request_created')

    expect(construct).not.toHaveBeenCalled()
  })
})
