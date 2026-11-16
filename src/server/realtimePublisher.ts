import { setTimeout as delay } from 'node:timers/promises'

export type CentrifugoPublisherOptions = {
  apiUrl: string
  apiKey: string
  onError: (error: unknown, channel: string) => void
  fetch?: typeof fetch
  retryMs?: number
  maxConcurrentChannels?: number
  maxPendingChannels?: number
}

/** `coalesce: false` sends this publication even when a newer one follows, such as a typing ping beside a change. */
export type PublishOptions = { coalesce?: boolean }

type PendingChannel = { queued: { data: unknown; coalesce: boolean }[] }

const requestTimeoutMs = 5_000
const maxRetries = 3
// Bounds the publications that do not coalesce, since each one waits for its own request.
const maxQueuedPerChannel = 64

/**
 * Publishes to Centrifugo's HTTP API in the background. Publications to one channel keep their order, and while one is in
 * flight a newer publication replaces the one still queued, so payloads should say what changed rather than carry state a
 * client must not miss. A publication with `coalesce: false` is never replaced.
 */
export class CentrifugoPublisher {
  private readonly pending = new Map<string, PendingChannel>()
  private readonly queue: string[] = []
  private readonly idleWaiters = new Set<() => void>()
  private readonly options: CentrifugoPublisherOptions
  private readonly request: typeof fetch
  private readonly publishUrl: string
  private active = 0
  private closed = false

  constructor(options: CentrifugoPublisherOptions) {
    this.options = options
    this.request = options.fetch ?? fetch
    this.publishUrl = `${options.apiUrl.replace(/\/$/, '')}/publish`
  }

  /** Queues a publication; false when the publisher is closed or too many are waiting, after reporting why. */
  publish(channel: string, data: unknown, { coalesce = true }: PublishOptions = {}) {
    if (this.closed) {
      this.reportError(new Error('Realtime publisher is closed'), channel)
      return false
    }
    const pending = this.pending.get(channel)
    if (pending) {
      const replaced = coalesce ? pending.queued.findIndex((publication) => publication.coalesce) : -1
      if (replaced !== -1) pending.queued.splice(replaced, 1)
      // A coalescing publication holds at most one slot, so only the ones that never coalesce can fill the queue.
      else if (!coalesce && pending.queued.length >= maxQueuedPerChannel) {
        this.reportError(new Error('Realtime publisher queue is full'), channel)
        return false
      }
      pending.queued.push({ data, coalesce })
      return true
    }
    if (this.pending.size >= (this.options.maxPendingChannels ?? 1_024)) {
      this.reportError(new Error('Realtime publisher queue is full'), channel)
      return false
    }
    this.pending.set(channel, { queued: [{ data, coalesce }] })
    this.queue.push(channel)
    this.pump()
    return true
  }

  idle() {
    if (this.isIdle()) return Promise.resolve()
    return new Promise<void>((resolve) => this.idleWaiters.add(resolve))
  }

  /** Refuses new publications and waits for accepted ones, including their retries, until `signal` aborts. */
  async close(signal?: AbortSignal) {
    this.closed = true
    const idle = this.idle()
    if (!signal) return idle
    signal.throwIfAborted()
    let abort!: () => void
    const aborted = new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
    })
    try {
      await Promise.race([idle, aborted])
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }

  private pump() {
    while (this.active < (this.options.maxConcurrentChannels ?? 8)) {
      const channel = this.queue.shift()
      if (channel === undefined) break
      // A channel is queued only alongside a fresh pending state.
      const state = this.pending.get(channel)!
      this.active++
      void this.flush(channel, state).finally(() => {
        this.active--
        this.pump()
        this.resolveIdle()
      })
    }
  }

  private async flush(channel: string, state: PendingChannel) {
    try {
      // Publications for one channel must keep their order.
      for (let next = state.queued.shift(); next; next = state.queued.shift()) await this.deliver(channel, next.data)
      this.pending.delete(channel)
    } catch (error) {
      // Publications queued while the failing one was in flight are newer, so they still go out.
      if (state.queued.length > 0) {
        this.queue.push(channel)
        this.pump()
      } else this.pending.delete(channel)
      this.reportError(error, channel)
    }
  }

  private async deliver(channel: string, data: unknown) {
    for (let retries = 0; ; retries++) {
      try {
        await this.deliverOnce(channel, data)
        return
      } catch (error) {
        if (!(error instanceof TransientPublishError) || retries >= maxRetries) throw error
        // Retrying must finish before a later publication can overtake this one.
        await delay(this.options.retryMs ?? 1_000)
      }
    }
  }

  private async deliverOnce(channel: string, data: unknown) {
    let response: Response
    try {
      response = await this.request(this.publishUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': this.options.apiKey },
        body: JSON.stringify({ channel, data }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      })
    } catch (error) {
      // fetch rejects with a TypeError when the connection itself fails.
      if (error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError')) {
        throw new TransientPublishError('Realtime publish request failed', { cause: error })
      }
      throw error
    }

    if (!response.ok) {
      const message = `Realtime publish failed with status ${response.status}`
      if (response.status >= 500 || response.status === 429) throw new TransientPublishError(message)
      throw new Error(message)
    }

    // Centrifugo answers 200 with an error object, so the body decides whether another attempt is worthwhile.
    const error = centrifugoError(await response.json())
    if (!error) return
    const message = `Realtime publish failed: ${error.message ?? `code ${error.code ?? 'unknown'}`}`
    if (error.code === 100) throw new TransientPublishError(message)
    throw new Error(message)
  }

  private reportError(error: unknown, channel: string) {
    try {
      this.options.onError(error, channel)
    } catch {}
  }

  private isIdle() {
    return this.pending.size === 0 && this.active === 0 && this.queue.length === 0
  }

  private resolveIdle() {
    if (!this.isIdle()) return
    for (const resolve of this.idleWaiters) resolve()
    this.idleWaiters.clear()
  }
}

class TransientPublishError extends Error {}

function centrifugoError(result: unknown): { code?: number; message?: string } | undefined {
  if (!result || typeof result !== 'object' || !('error' in result) || !result.error || typeof result.error !== 'object') return undefined
  const { code, message } = result.error as { code?: unknown; message?: unknown }
  return { ...(typeof code === 'number' ? { code } : {}), ...(typeof message === 'string' ? { message } : {}) }
}
