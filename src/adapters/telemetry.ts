import type { Telemetry } from '../core/types'
import { SeverityNumber, type AnyValue, type LogRecord } from '@opentelemetry/api-logs'
type PostHogClient = InstanceType<(typeof import('posthog-node'))['PostHog']>
type LogProvider = InstanceType<(typeof import('@opentelemetry/sdk-logs'))['LoggerProvider']>

export class OptionalPostHogTelemetry implements Telemetry {
  private client?: Promise<PostHogClient>
  private logProvider?: Promise<LogProvider>
  private closed = false

  constructor(private enabled: () => boolean) {}

  async start() {
    try {
      if (!this.enabled() || this.closed) return
      await Promise.all([this.getClient(), this.getLogProvider()])
    } catch {}
  }

  async capture(identity: string, event: string, properties?: Record<string, unknown>) {
    try {
      if (!this.enabled() || this.closed) return
      const client = await this.getClient()
      if (!client) return
      client.capture({ distinctId: identity, event, properties })
    } catch {}
  }

  async exception(error: unknown, properties?: Record<string, unknown>) {
    try {
      if (!this.enabled() || this.closed) return
      const client = await this.getClient()
      client?.captureException(error, 'server', properties)
    } catch {}
  }

  async log(record: Record<string, unknown>) {
    try {
      if (!this.enabled() || this.closed) return
      const provider = await this.getLogProvider()
      provider?.getLogger('stlquest').emit(toLogRecord(record))
    } catch {}
  }

  async shutdown() {
    if (this.closed) return
    this.closed = true
    try {
      await Promise.all([(await this.client)?.shutdown(), (await this.logProvider)?.shutdown()])
    } catch {}
  }

  private getClient() {
    if (this.closed) return undefined
    if (!this.client) {
      const token = process.env.VITE_POSTHOG_PROJECT_TOKEN
      const host = process.env.VITE_POSTHOG_HOST
      if (!token || !host) throw new Error('PostHog environment variables are required')
      const client = import('posthog-node').then(
        ({ PostHog }) => new PostHog(token, { host, flushAt: 1, flushInterval: 0, enableExceptionAutocapture: true }),
      )
      this.client = client
      void client.catch(() => {
        if (this.client === client) this.client = undefined
      })
    }
    return this.client
  }

  private getLogProvider() {
    if (this.closed) return undefined
    if (!this.logProvider) {
      const token = process.env.VITE_POSTHOG_PROJECT_TOKEN
      const host = process.env.VITE_POSTHOG_HOST
      if (!token || !host) throw new Error('PostHog environment variables are required')
      const provider = Promise.all([
        import('@opentelemetry/exporter-logs-otlp-http'),
        import('@opentelemetry/resources'),
        import('@opentelemetry/sdk-logs'),
      ]).then(([{ OTLPLogExporter }, { resourceFromAttributes }, { BatchLogRecordProcessor, LoggerProvider }]) => {
        const exporter = new OTLPLogExporter({
          url: `${host.replace(/\/$/, '')}/i/v1/logs`,
          headers: { Authorization: `Bearer ${token}` },
        })
        return new LoggerProvider({
          resource: resourceFromAttributes({
            'service.name': 'stlquest',
            'service.version': typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'development',
            'deployment.environment': process.env.NODE_ENV ?? 'development',
          }),
          processors: [new BatchLogRecordProcessor({ exporter })],
        })
      })
      this.logProvider = provider
      void provider.catch(() => {
        if (this.logProvider === provider) this.logProvider = undefined
      })
    }
    return this.logProvider
  }
}

function toLogRecord({ level, msg, time, ...properties }: Record<string, unknown>): LogRecord {
  const severity = typeof level === 'number' ? severityFor(level) : undefined
  const attributes = Object.fromEntries(
    Object.entries(properties)
      .map(([key, value]) => [key, logValue(value)])
      .filter((entry): entry is [string, AnyValue] => entry[1] !== undefined),
  )
  return {
    body: typeof msg === 'string' ? msg : '',
    timestamp: typeof time === 'number' ? time : undefined,
    severityNumber: severity?.number,
    severityText: severity?.text,
    attributes,
  }
}

function severityFor(level: number) {
  if (level >= 60) return { number: SeverityNumber.FATAL, text: 'fatal' }
  if (level >= 50) return { number: SeverityNumber.ERROR, text: 'error' }
  if (level >= 40) return { number: SeverityNumber.WARN, text: 'warn' }
  if (level >= 30) return { number: SeverityNumber.INFO, text: 'info' }
  if (level >= 20) return { number: SeverityNumber.DEBUG, text: 'debug' }
  return { number: SeverityNumber.TRACE, text: 'trace' }
}

function logValue(value: unknown): AnyValue {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value as AnyValue
  if (Array.isArray(value)) return value.map(logValue)
  if (value === undefined) return undefined
  try {
    return JSON.stringify(value)
  } catch {
    return '[Unserializable value]'
  }
}
