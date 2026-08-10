import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OptionalPostHogTelemetry } from './telemetry'

const { capture, captureExceptionImmediate, shutdown, construct, emit, logShutdown, exporterConstruct, providerConstruct } = vi.hoisted(
  () => ({
    capture: vi.fn(),
    captureExceptionImmediate: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => undefined),
    construct: vi.fn(),
    emit: vi.fn(),
    logShutdown: vi.fn(async () => undefined),
    exporterConstruct: vi.fn(),
    providerConstruct: vi.fn(),
  }),
)

vi.mock('ras-stack/posthog/server', () => ({
  createPostHogServerClient: (environment: { projectToken: string; host: string }, options: Record<string, unknown>) => {
    construct(environment.projectToken, { host: environment.host, ...options, enableExceptionAutocapture: true })
    return Promise.resolve({ capture, captureExceptionImmediate })
  },
  shutdownPostHogServerClient: async (client: unknown) => {
    if (client) await shutdown()
  },
}))

vi.mock('@opentelemetry/exporter-logs-otlp-http', () => ({
  OTLPLogExporter: function OTLPLogExporter(...args: unknown[]) {
    exporterConstruct(...args)
  },
}))

vi.mock('@opentelemetry/resources', () => ({ resourceFromAttributes: (attributes: unknown) => attributes }))

vi.mock('@opentelemetry/sdk-logs', () => ({
  BatchLogRecordProcessor: function BatchLogRecordProcessor() {},
  LoggerProvider: class {
    constructor(...args: unknown[]) {
      providerConstruct(...args)
    }

    getLogger() {
      return { emit }
    }

    shutdown = logShutdown
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

  it('uses the error tracking API for server exceptions', async () => {
    const telemetry = new OptionalPostHogTelemetry(() => true)
    const failure = new Error('database unavailable')

    await telemetry.exception(failure, { action: 'sign_in' })

    expect(captureExceptionImmediate).toHaveBeenCalledWith(failure, 'server', { action: 'sign_in' })
  })

  it('starts exception autocapture and OTLP logging eagerly', async () => {
    const telemetry = new OptionalPostHogTelemetry(() => true)

    await telemetry.start()

    expect(construct).toHaveBeenCalledOnce()
    expect(exporterConstruct).toHaveBeenCalledWith({
      url: 'https://posthog.test/i/v1/logs',
      headers: { Authorization: 'Bearer test-token' },
    })
    expect(providerConstruct).toHaveBeenCalledOnce()
  })

  it('exports structured Pino records as OpenTelemetry logs', async () => {
    const telemetry = new OptionalPostHogTelemetry(() => true)

    await telemetry.log({ level: 50, time: 1_234, msg: 'request failed', requestId: 'request-id', err: { type: 'Error' } })

    expect(emit).toHaveBeenCalledWith({
      body: 'request failed',
      timestamp: 1_234,
      severityNumber: 17,
      severityText: 'error',
      attributes: { requestId: 'request-id', err: '{"type":"Error"}' },
    })
  })

  it('does not construct a client when telemetry remains disabled', async () => {
    const telemetry = new OptionalPostHogTelemetry(() => false)

    await telemetry.capture('first', 'request_created')
    await telemetry.shutdown()

    expect(construct).not.toHaveBeenCalled()
    expect(shutdown).not.toHaveBeenCalled()
    expect(logShutdown).not.toHaveBeenCalled()
  })

  it('silently no-ops when the PostHog environment variables are unset', async () => {
    delete process.env.VITE_POSTHOG_PROJECT_TOKEN
    delete process.env.VITE_POSTHOG_HOST
    const telemetry = new OptionalPostHogTelemetry(() => true)

    await telemetry.capture('first', 'request_created')

    expect(construct).not.toHaveBeenCalled()
  })
})
