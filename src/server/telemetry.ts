import { SeverityNumber } from '@opentelemetry/api'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs'
import { PostHog, type BeforeSendFn } from 'posthog-node'
import { hostVariable, postHogEnvironment, projectTokenVariable, serviceName } from '../contracts/posthog'
import { currentServerFunction } from './serverFunction'

export type Telemetry = ReturnType<typeof createTelemetry>
export type LogSeverity = keyof typeof severities
/** What the application adds: its release as `service.version`, resource attributes such as the deployment's host, and an event filter. */
export type TelemetryOptions = { serviceVersion?: string; resourceAttributes?: Record<string, string>; beforeSend?: BeforeSendFn }

const severities = { debug: SeverityNumber.DEBUG, info: SeverityNumber.INFO, warn: SeverityNumber.WARN, error: SeverityNumber.ERROR }

/**
 * Server analytics, exceptions, metrics, and spans through `posthog`, plus OTLP logs through `log`. Without
 * the project token it sends nothing, and `withSpan` still runs its work.
 */
export function createTelemetry(env: Record<string, string | undefined> = process.env, options: TelemetryOptions = {}) {
  const environment = postHogEnvironment({ projectToken: env[projectTokenVariable], host: env[hostVariable] })
  const service = {
    serviceName: `${serviceName}-server`,
    environment: env.NODE_ENV ?? 'development',
    serviceVersion: options.serviceVersion,
    resourceAttributes: options.resourceAttributes,
  }
  const posthog = new PostHog(environment?.projectToken ?? 'disabled', {
    host: environment?.host,
    before_send: options.beforeSend,
    disabled: !environment,
    enableExceptionAutocapture: Boolean(environment),
    metrics: service,
    traces: service,
  })
  const logs =
    environment &&
    new LoggerProvider({
      resource: resourceFromAttributes({
        ...options.resourceAttributes,
        'service.name': service.serviceName,
        'deployment.environment': service.environment,
        ...(options.serviceVersion ? { 'service.version': options.serviceVersion } : {}),
      }),
      // Bounds what one careless attribute, such as a whole request body, can add to a record.
      logRecordLimits: { attributeCountLimit: 64, attributeValueLengthLimit: 2_048 },
      processors: [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({
            url: `${environment.host}/i/v1/logs`,
            headers: { Authorization: `Bearer ${environment.projectToken}` },
          }),
        }),
      ],
    })
  const logger = logs?.getLogger(service.serviceName)

  return {
    posthog,

    /** Records a structured log, linked to the current request's person, session, and server function. */
    log(severity: LogSeverity, body: string, attributes: Record<string, unknown> = {}) {
      if (!logger) return
      const context = posthog.getContext()
      const serverFunction = currentServerFunction()?.name
      logger.emit({
        severityNumber: severities[severity],
        severityText: severity,
        body: body.slice(0, 2_048),
        attributes: {
          ...Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key, logValue(value)])),
          ...(serverFunction ? { server_function: serverFunction } : {}),
          ...(context?.distinctId ? { posthogDistinctId: context.distinctId } : {}),
          ...(context?.sessionId ? { sessionId: context.sessionId } : {}),
        },
      })
    },

    async flush() {
      await Promise.all([posthog.flush(), logs?.forceFlush()])
    },

    /**
     * Sends what is queued; the log exporter gets its own deadline because it can wait on a stalled connection. The default
     * is this resource's share of the shutdown budget in start-app's README.
     */
    async shutdown(timeoutMs = 2_000) {
      try {
        await Promise.all([posthog.shutdown(timeoutMs), logs && withDeadline(logs.shutdown(), timeoutMs, 'PostHog log shutdown')])
      } finally {
        // A request still running after shutdown would otherwise queue events that a later flush or timer sends.
        await posthog.disable()
      }
    },
  }
}

const personOrSessionId = /^[A-Za-z0-9._:@|+-]{1,128}$/

/**
 * The PostHog context for work done for `request`: the browser's session, and its person only when the application's own
 * authentication agrees, because any client can send any id in these headers.
 */
export function requestContext(request: Request, authenticatedDistinctId?: string): Parameters<PostHog['withContext']>[0] {
  const claimed = boundedId(request.headers.get('x-posthog-distinct-id'))
  const sessionId = boundedId(request.headers.get('x-posthog-session-id'))
  return {
    ...(trustedPerson(claimed, authenticatedDistinctId) ? { distinctId: claimed } : {}),
    ...(sessionId ? { sessionId } : {}),
  }
}

// posthog-js names an anonymous browser person with a version 7 UUID, which Better Auth's 32-character ids never match, so a signed-out claim cannot land on an account.
const anonymousPerson = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function trustedPerson(claimed: string | undefined, authenticatedDistinctId: string | undefined) {
  if (!claimed) return false
  return authenticatedDistinctId ? claimed === authenticatedDistinctId : anonymousPerson.test(claimed)
}

function boundedId(value: string | null) {
  return value && personOrSessionId.test(value) ? value : undefined
}

function logValue(value: unknown) {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Error) return `${value.name}: ${value.message}`
  try {
    return JSON.stringify(value) ?? '[Unserializable value]'
  } catch {
    return '[Unserializable value]'
  }
}

async function withDeadline(work: Promise<unknown>, timeoutMs: number, name: string) {
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${name} timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  try {
    await Promise.race([work, deadline])
  } finally {
    clearTimeout(timer)
  }
}
