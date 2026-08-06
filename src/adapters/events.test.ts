import { afterEach, describe, expect, it, vi } from 'vitest'
import { CentrifugoEventBus, CentrifugoPublisher, LocalEventBus } from './events'

afterEach(() => vi.restoreAllMocks())

describe('LocalEventBus', () => {
  it('delivers events to in-process subscribers', () => {
    const bus = new LocalEventBus()
    const heard = vi.fn()
    bus.subscribe(heard)

    bus.publish('request.created')

    expect(heard).toHaveBeenCalledExactlyOnceWith('request.created')
  })
})

describe('CentrifugoEventBus', () => {
  it('publishes workspace events through the Centrifugo API', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    const bus = new CentrifugoEventBus(new CentrifugoPublisher('http://centrifugo/api', 'key'), 'workspace')

    bus.publish('request.created')

    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith('http://centrifugo/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'key' },
        body: JSON.stringify({ channel: 'workspace:workspace', data: { event: 'request.created' } }),
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('only coordinates storage changes between replicas', () => {
    const replicas = { publish: vi.fn() }
    const bus = new CentrifugoEventBus(new CentrifugoPublisher('', ''), 'workspace', replicas as never)

    bus.publish('request.created')
    bus.publish('storage.changed')

    expect(replicas.publish).toHaveBeenCalledExactlyOnceWith('workspace')
  })

  it('delivers publications in mutation order', async () => {
    let releaseFirst!: () => void
    const firstResponse = new Promise<Response>((resolve) => {
      releaseFirst = () => resolve(new Response('{}'))
    })
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => firstResponse)
      .mockResolvedValueOnce(new Response('{}'))
    const publisher = new CentrifugoPublisher('http://centrifugo/api', 'key')

    publisher.publish('workspace', 'request.created')
    publisher.publish('workspace', 'request.updated')

    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    releaseFirst()
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    expect(request.mock.calls.map(([, options]) => options?.body)).toEqual([
      JSON.stringify({ channel: 'workspace:workspace', data: { event: 'request.created' } }),
      JSON.stringify({ channel: 'workspace:workspace', data: { event: 'request.updated' } }),
    ])
  })

  it('does not block one workspace behind another', async () => {
    let releaseFirst!: () => void
    const firstResponse = new Promise<Response>((resolve) => {
      releaseFirst = () => resolve(new Response('{}'))
    })
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => firstResponse)
      .mockResolvedValueOnce(new Response('{}'))
    const publisher = new CentrifugoPublisher('http://centrifugo/api', 'key')

    publisher.publish('one', 'request.created')
    publisher.publish('two', 'request.created')

    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    releaseFirst()
  })

  it('retries a failed request before continuing', async () => {
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('unavailable'))
      .mockImplementation(() => Promise.resolve(new Response('{}')))
    const publisher = new CentrifugoPublisher('http://centrifugo/api', 'key', 5_000, 1)

    publisher.publish('workspace', 'request.created')
    publisher.publish('workspace', 'request.updated')

    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3))
  })

  it('retries an internal error returned in a successful HTTP response', async () => {
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 100, message: 'internal server error' } })))
      .mockImplementation(() => Promise.resolve(new Response('{}')))
    const publisher = new CentrifugoPublisher('http://centrifugo/api', 'key', 5_000, 1)

    publisher.publish('workspace', 'request.created')

    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  })

  it('times out a stalled request before delivering the next publication', async () => {
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce((_input, options) => {
        return new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
        })
      })
      .mockImplementation(() => Promise.resolve(new Response('{}')))
    const publisher = new CentrifugoPublisher('http://centrifugo/api', 'key', 10, 1)

    publisher.publish('workspace', 'request.created')
    publisher.publish('workspace', 'request.updated')

    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3))
  })
})
