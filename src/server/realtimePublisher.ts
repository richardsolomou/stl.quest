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

type PendingPublication = { dirty: boolean; data: unknown }

const requestTimeoutMs = 5_000
const maxRetries = 3

/**
 * Publishes to Centrifugo's HTTP API in the background. Publications to one channel keep their order and coalesce to the
 * latest while one is in flight, so payloads should say what changed rather than carry state a client must not miss.
 */
export class CentrifugoPublisher {
  private readonly pending = new Map<string, PendingPublication>()
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

  /** Queues a publication; false when the publisher is closed or too many channels are waiting, after reporting why. */
  publish(channel: string, data: unknown) {
    if (this.closed) {
      this.reportError(new Error('Realtime publisher is closed'), channel)
      return false
    }
    const pending = this.pending.get(channel)
    if (pending) {
      pending.dirty = true
      pending.data = data
      return true
    }
    if (this.pending.size >= (this.options.maxPendingChannels ?? 1_024)) {
      this.reportError(new Error('Realtime publisher queue is full'), channel)
      return false
    }
    this.pending.set(channel, { dirty: true, data })
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

  private async flush(channel: string, state: PendingPublication) {
    let failure: unknown
    try {
      while (state.dirty) {
        state.dirty = false
        // Publications for one channel must keep their order.
        await this.deliver(channel, state.data)
      }
    } catch (error) {
      failure = error
    } finally {
      if (this.pending.get(channel) === state) this.pending.delete(channel)
    }
    if (failure === undefined) return
    // A publication queued while the failing one was in flight is newer, so it still goes out.
    if (state.dirty) {
      this.pending.set(channel, { dirty: true, data: state.data })
      this.queue.push(channel)
      this.pump()
    }
    this.reportError(failure, channel)
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
