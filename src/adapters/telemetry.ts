import type { Telemetry } from '../core/types'
import { TELEMETRY_HOST, TELEMETRY_TOKEN } from '../core/telemetry'

type PostHogClient = InstanceType<(typeof import('posthog-node'))['PostHog']>

export class OptionalPostHogTelemetry implements Telemetry {
  private client?: Promise<PostHogClient>
  private closed = false

  constructor(private enabled: () => boolean) {}

  async capture(identity: string, event: string, properties?: Record<string, unknown>) {
    try {
      if (!this.enabled() || this.closed) return
      const client = await this.getClient()
      if (!client) return
      client.capture({ distinctId: identity, event, properties })
    } catch {}
  }

  async exception(error: unknown, properties?: Record<string, unknown>) {
    await this.capture('server', '$exception', { ...properties, error: error instanceof Error ? error.message : String(error) })
  }

  async shutdown() {
    if (this.closed) return
    this.closed = true
    try {
      await (await this.client)?.shutdown()
    } catch {}
  }

  private getClient() {
    if (this.closed) return undefined
    if (!this.client) {
      const client = import('posthog-node').then(
        ({ PostHog }) => new PostHog(TELEMETRY_TOKEN, { host: TELEMETRY_HOST, flushAt: 1, flushInterval: 0 }),
      )
      this.client = client
      void client.catch(() => {
        if (this.client === client) this.client = undefined
      })
    }
    return this.client
  }
}
