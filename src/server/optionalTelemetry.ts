import type { Telemetry } from '../core/types'
import { observeServerFunction } from './rpcTelemetry'
import { createTelemetry, type LogSeverity } from './telemetry'

type RpcObserver = <T>(request: Request | undefined, work: () => Promise<T>) => Promise<T>

let activeRpcObserver: RpcObserver | undefined

/** Runs a server function inside the running application's telemetry span, or plainly when none is active. */
export const observeRpc: RpcObserver = async (request, work) => (activeRpcObserver ? activeRpcObserver(request, work) : work())

export function setRpcTelemetry(telemetry?: OptionalPostHogTelemetry) {
  activeRpcObserver = telemetry?.rpcObserver
}

/**
 * Server telemetry behind the deployment's telemetry setting. A deployment that turned telemetry off at startup never creates
 * a PostHog client, so exception autocapture installs no handlers and nothing is sent.
 */
export class OptionalPostHogTelemetry implements Telemetry {
  private readonly telemetry
  readonly rpcObserver: RpcObserver

  constructor(
    private readonly enabled: () => boolean,
    private readonly context: Record<string, unknown> = {},
  ) {
    this.telemetry = createTelemetry(enabled() ? process.env : { NODE_ENV: process.env.NODE_ENV }, {
      serviceVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'development',
    })
    this.rpcObserver = (request, work) => (this.enabled() ? observeServerFunction(this.telemetry, request, work) : work())
  }

  capture(identity: string, event: string, properties?: Record<string, unknown>) {
    if (!this.enabled()) return
    this.telemetry.posthog.capture({ distinctId: identity, event, properties: { ...properties, ...this.context } })
  }

  exception(error: unknown, properties?: Record<string, unknown>) {
    if (!this.enabled()) return
    const { posthogDistinctId, sessionId, ...context } = properties ?? {}
    this.telemetry.posthog.captureException(error, typeof posthogDistinctId === 'string' ? posthogDistinctId : undefined, {
      ...context,
      ...(typeof sessionId === 'string' ? { $session_id: sessionId } : {}),
    })
  }

  /** Sends a Pino record as a PostHog log. */
  log({ level, msg, time: _time, ...attributes }: Record<string, unknown>) {
    if (!this.enabled()) return
    this.telemetry.log(typeof level === 'number' ? severityFor(level) : 'info', typeof msg === 'string' ? msg : '', attributes)
  }

  shutdown() {
    return this.telemetry.shutdown()
  }
}

export function withTelemetryContext(telemetry: Telemetry, context: Record<string, unknown>): Telemetry {
  return {
    capture: (identity, event, properties) => telemetry.capture(identity, event, { ...properties, ...context }),
    exception: (error, properties) => telemetry.exception(error, properties),
  }
}

// Pino's trace and fatal levels have no OTLP severity of their own in `telemetry.log`.
function severityFor(level: number): LogSeverity {
  if (level >= 50) return 'error'
  if (level >= 40) return 'warn'
  if (level >= 30) return 'info'
  return 'debug'
}
