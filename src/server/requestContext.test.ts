import { describe, expect, it } from 'vitest'
import { currentRequestId, withRequestContext } from './requestContext'

describe('request context', () => {
  it('preserves a caller request id and adds it to the response', async () => {
    const response = await withRequestContext(
      new Request('http://print.test/api/probe', { headers: { 'x-request-id': 'probe-id' } }),
      async () => Response.json({ requestId: currentRequestId() }),
    )
    expect(response.headers.get('x-request-id')).toBe('probe-id')
    await expect(response.json()).resolves.toEqual({ requestId: 'probe-id' })
  })

  it('generates an id and normalizes thrown responses', async () => {
    const response = await withRequestContext(new Request('http://print.test/api/probe'), async () => {
      throw new Response('missing', { status: 404 })
    })
    expect(response.status).toBe(404)
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })
})
