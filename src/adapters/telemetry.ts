import type { Telemetry } from '../core/types'
import { postHogEnvironment } from 'ras-stack/posthog'
import { createManagedPostHogServerTelemetry } from 'ras-stack/posthog/server'

export class OptionalPostHogTelemetry implements Telemetry {
  private readonly telemetry

  constructor(
    private readonly enabled: () => boolean,
    private readonly context: Record<string, unknown> = {},
  ) {
    this.telemetry = createManagedPostHogServerTelemetry({
      environment: postHogEnvironment({
        projectToken: process.env.VITE_POSTHOG_PROJECT_TOKEN,
        host: process.env.VITE_POSTHOG_HOST,
      }),
      serviceName: 'stlquest',
      serviceVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'development',
      deploymentEnvironment: process.env.NODE_ENV ?? 'development',
      clientOptions: { enableExceptionAutocapture: process.env.NODE_ENV !== 'test' },
    })
  }

  start() {
    if (!this.enabled()) return Promise.resolve()
    return this.telemetry.start()
  }

  capture(identity: string, event: string, properties?: Record<string, unknown>) {
    if (!this.enabled()) return Promise.resolve()
    return this.telemetry.capture(identity, event, { ...properties, ...this.context })
  }

  exception(error: unknown, properties?: Record<string, unknown>) {
    if (!this.enabled()) return Promise.resolve()
    const { posthogDistinctId, sessionId, ...context } = properties ?? {}
    return this.telemetry.exception(error, typeof posthogDistinctId === 'string' ? posthogDistinctId : 'server', {
      ...context,
      ...(typeof sessionId === 'string' ? { $session_id: sessionId } : {}),
    })
  }

  log({ level, msg, time, ...attributes }: Record<string, unknown>) {
    if (!this.enabled()) return Promise.resolve()
    return this.telemetry.log({
      body: typeof msg === 'string' ? msg : '',
      ...(typeof level === 'number' ? { severityText: severityFor(level) } : {}),
      ...(typeof time === 'number' ? { timestamp: time } : {}),
      attributes,
    })
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

function severityFor(level: number) {
  if (level >= 60) return 'fatal' as const
  if (level >= 50) return 'error' as const
  if (level >= 40) return 'warn' as const
  if (level >= 30) return 'info' as const
  if (level >= 20) return 'debug' as const
  return 'trace' as const
}
