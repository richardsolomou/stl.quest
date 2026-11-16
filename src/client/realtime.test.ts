import { EventEmitter } from 'node:events'
import { Centrifuge } from 'centrifuge'
import { describe, expect, it, vi } from 'vitest'
import { createRealtimeClient, realtimeToken, watchServerChannel } from './realtime'

vi.mock('centrifuge', async (importOriginal) => ({ ...(await importOriginal<typeof import('centrifuge')>()), Centrifuge: vi.fn() }))

const answering = (response: Response) => vi.fn<typeof fetch>().mockResolvedValue(response)

describe('realtime client', () => {
  it('connects to a secure WebSocket on the page’s own origin', () => {
    createRealtimeClient({ protocol: 'https:', host: 'example.com' })
    expect(Centrifuge).toHaveBeenLastCalledWith('wss://example.com/connection/websocket', { getToken: expect.any(Function) })
  })

  it('keeps a development origin on an insecure WebSocket', () => {
    createRealtimeClient({ protocol: 'http:', host: 'localhost:3000' })
    expect(Centrifuge).toHaveBeenLastCalledWith('ws://localhost:3000/connection/websocket', { getToken: expect.any(Function) })
  })
})

describe('realtime token', () => {
  it('asks for a subscription token for a channel', async () => {
    const request = answering(Response.json({ token: 'signed' }))
    await expect(realtimeToken('updates:one', request)).resolves.toBe('signed')
    expect(request).toHaveBeenCalledWith('/api/realtime/token', expect.objectContaining({ body: '{"channel":"updates:one"}' }))
  })

  it('turns a refusal into an unauthorized error so the client stops retrying', async () => {
    await expect(realtimeToken(undefined, answering(new Response(null, { status: 403 })))).rejects.toMatchObject({
      name: 'UnauthorizedError',
    })
  })

  it('reports any other failure so the client retries', async () => {
    await expect(realtimeToken(undefined, answering(new Response(null, { status: 503 })))).rejects.toThrow(
      'Realtime authentication failed with status 503',
    )
  })
})

describe('server channel', () => {
  const subscribed = (recovered: boolean) => ({
    channel: 'user:one',
    recoverable: true,
    positioned: false,
    wasRecovering: true,
    recovered,
    hasRecoveredPublications: recovered,
  })

  it('delivers only its channel’s publications until cleaned up', () => {
    const client = new EventEmitter() as unknown as Centrifuge
    const publication = vi.fn()
    const cleanup = watchServerChannel(client, 'user:one', { publication })
    client.emit('publication', { channel: 'user:one', data: {} })
    client.emit('publication', { channel: 'user:two', data: {} })
    cleanup()
    client.emit('publication', { channel: 'user:one', data: {} })
    expect(publication).toHaveBeenCalledOnce()
  })

  it('reports a reconnect that lost publications', () => {
    const client = new EventEmitter() as unknown as Centrifuge
    const unrecovered = vi.fn()
    watchServerChannel(client, 'user:one', { unrecovered })
    client.emit('subscribed', subscribed(false))
    expect(unrecovered).toHaveBeenCalledOnce()
  })

  it('stays quiet when a reconnect recovered what it missed', () => {
    const client = new EventEmitter() as unknown as Centrifuge
    const unrecovered = vi.fn()
    watchServerChannel(client, 'user:one', { unrecovered })
    client.emit('subscribed', subscribed(true))
    expect(unrecovered).not.toHaveBeenCalled()
  })
})
