import { describe, expect, it, vi } from 'vitest'
import { CentrifugoPublisher, type CentrifugoPublisherOptions } from './realtimePublisher'

const ok = () => Promise.resolve(Response.json({}))
const bodies = (request: ReturnType<typeof vi.fn<typeof fetch>>) => request.mock.calls.map(([, init]) => init?.body)
const publication = (channel: string, data: unknown) => JSON.stringify({ channel, data })

describe('Centrifugo publisher', () => {
  it('publishes to the HTTP API with the API key', async () => {
    const request = vi.fn<typeof fetch>(ok)
    const publisher = publisherWith(request, { apiUrl: 'http://realtime/api/' })
    publisher.publish('updates:one', { type: 'change' })
    await publisher.idle()
    expect(request).toHaveBeenCalledWith('http://realtime/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'key' },
      body: publication('updates:one', { type: 'change' }),
      signal: expect.any(AbortSignal),
    })
  })

  it('reports a rejected publication without retrying', async () => {
    const onError = vi.fn()
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 400 }))
    const publisher = publisherWith(request, { onError })
    publisher.publish('one', {})
    await publisher.idle()
    expect(request).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Realtime publish failed with status 400' }), 'one')
  })

  it('retries a connection failure', async () => {
    const request = vi.fn<typeof fetch>(ok).mockRejectedValueOnce(new TypeError('fetch failed'))
    const publisher = publisherWith(request)
    publisher.publish('one', {})
    await publisher.idle()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('retries a request that timed out', async () => {
    const request = vi.fn<typeof fetch>(ok).mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'))
    const publisher = publisherWith(request)
    publisher.publish('one', {})
    await publisher.idle()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('retries a server error', async () => {
    const request = vi.fn<typeof fetch>(ok).mockResolvedValueOnce(new Response('{}', { status: 503 }))
    const publisher = publisherWith(request)
    publisher.publish('one', {})
    await publisher.idle()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('retries the internal error Centrifugo reports in a successful response', async () => {
    const request = vi.fn<typeof fetch>(ok).mockResolvedValueOnce(Response.json({ error: { code: 100, message: 'internal server error' } }))
    const publisher = publisherWith(request)
    publisher.publish('one', {})
    await publisher.idle()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('reports a permanent error Centrifugo describes without retrying', async () => {
    const onError = vi.fn()
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: 102, message: 'unknown channel' } }))
    const publisher = publisherWith(request, { onError })
    publisher.publish('one', {})
    await publisher.idle()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Realtime publish failed: unknown channel' }), 'one')
  })

  it('describes an error Centrifugo reports without a message', async () => {
    const onError = vi.fn()
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: 102 } }))
    const publisher = publisherWith(request, { onError })
    publisher.publish('one', {})
    await publisher.idle()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Realtime publish failed: code 102' }), 'one')
  })

  it('reports a transient failure after its bounded retries', async () => {
    const onError = vi.fn()
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 503 }))
    const publisher = publisherWith(request, { onError })
    publisher.publish('one', {})
    await publisher.idle()
    expect(request).toHaveBeenCalledTimes(4)
  })

  it('drains a publication to an empty channel name', async () => {
    const request = vi.fn<typeof fetch>(ok)
    const publisher = publisherWith(request)
    publisher.publish('', {})
    await publisher.idle()
    expect(request).toHaveBeenCalledOnce()
  })

  it('coalesces pending publications per channel, keeping the latest', async () => {
    let release!: () => void
    const first = new Promise<Response>((resolve) => (release = () => resolve(Response.json({}))))
    const request = vi.fn<typeof fetch>(ok).mockImplementationOnce(() => first)
    const publisher = publisherWith(request)
    publisher.publish('one', { version: 1 })
    publisher.publish('one', { version: 2 })
    publisher.publish('one', { version: 3 })
    publisher.publish('two', { version: 1 })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    release()
    await publisher.idle()
    expect(bodies(request)).toEqual([
      publication('one', { version: 1 }),
      publication('two', { version: 1 }),
      publication('one', { version: 3 }),
    ])
  })

  it('does not lose a publication queued by the error handler', async () => {
    const request = vi.fn<typeof fetch>(ok).mockResolvedValueOnce(new Response('{}', { status: 400 }))
    const publisher: CentrifugoPublisher = publisherWith(request, { onError: () => publisher.publish('one', { version: 2 }) })
    publisher.publish('one', { version: 1 })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    expect(bodies(request)).toEqual([publication('one', { version: 1 }), publication('one', { version: 2 })])
  })

  it('delivers the latest publication queued while an earlier one fails', async () => {
    let fail!: () => void
    const first = new Promise<Response>((resolve) => (fail = () => resolve(new Response('{}', { status: 400 }))))
    const request = vi.fn<typeof fetch>(ok).mockImplementationOnce(() => first)
    const publisher = publisherWith(request)
    publisher.publish('one', { version: 1 })
    publisher.publish('one', { version: 2 })
    fail()
    await publisher.idle()
    expect(bodies(request)).toEqual([publication('one', { version: 1 }), publication('one', { version: 2 })])
  })

  it('bounds concurrent channels', async () => {
    const request = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined))
    const publisher = publisherWith(request, { maxConcurrentChannels: 1 })
    publisher.publish('one', {})
    publisher.publish('two', {})
    await Promise.resolve()
    expect(request).toHaveBeenCalledOnce()
  })

  it('refuses new channels when the pending bound is full', () => {
    const onError = vi.fn()
    const publisher = publisherWith(
      vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined)),
      { maxPendingChannels: 1, onError },
    )
    publisher.publish('one', {})
    expect(publisher.publish('two', {})).toBe(false)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Realtime publisher queue is full' }), 'two')
  })

  it('drains accepted publications before closing and refuses new ones', async () => {
    let release!: () => void
    const response = new Promise<Response>((resolve) => (release = () => resolve(Response.json({}))))
    const onError = vi.fn()
    const publisher = publisherWith(
      vi.fn<typeof fetch>(() => response),
      { onError },
    )
    publisher.publish('one', {})
    const closed = publisher.close()
    expect(publisher.publish('two', {})).toBe(false)
    release()
    await closed
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Realtime publisher is closed' }), 'two')
  })

  it('stops waiting at the shutdown deadline', async () => {
    const publisher = publisherWith(vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined)))
    const controller = new AbortController()
    publisher.publish('one', {})
    const closed = publisher.close(controller.signal)
    controller.abort(new DOMException('shutdown deadline exceeded', 'TimeoutError'))
    await expect(closed).rejects.toMatchObject({ name: 'TimeoutError' })
  })
})

function publisherWith(request: typeof fetch, overrides: Partial<CentrifugoPublisherOptions> = {}) {
  return new CentrifugoPublisher({
    apiUrl: 'http://realtime/api',
    apiKey: 'key',
    fetch: request,
    retryMs: 0,
    onError: vi.fn(),
    ...overrides,
  })
}
