import { describe, expect, it } from 'vitest'
import { serverSentComment, serverSentEvent, serverSentEventResponse, serverSentRetry } from './serverSentEvents'

const decode = (value: Uint8Array) => new TextDecoder().decode(value)

describe('server-sent events', () => {
  it('encodes named events', () => {
    expect(decode(serverSentEvent('change', '{"id":1}'))).toBe('event: change\ndata: {"id":1}\n\n')
  })

  it('encodes retry instructions', () => {
    expect(decode(serverSentRetry(2_000))).toBe('retry: 2000\n\n')
  })

  it('encodes comments', () => {
    expect(decode(serverSentComment('keepalive'))).toBe(': keepalive\n\n')
  })

  it('sets streaming response headers', () => {
    const response = serverSentEventResponse(new ReadableStream())

    expect(Object.fromEntries(response.headers)).toEqual({
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'content-type': 'text/event-stream',
    })
  })
})
