import { describe, expect, it, vi } from 'vitest'
import { logger } from './logger'
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

  it('logs unexpected request failures', async () => {
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => logger)
    const failure = new Error('database unavailable')

    await withRequestContext(
      new Request('http://print.test/api/auth/sign-in/email', { headers: { 'x-request-id': 'auth-failure' } }),
      async () => Promise.reject(failure),
    )

    expect(logged).toHaveBeenCalledWith({ err: failure }, 'request failed')
    logged.mockRestore()
  })

  it('logs completed requests with structured context', async () => {
    const logged = vi.spyOn(logger, 'info').mockImplementation(() => logger)

    await withRequestContext(new Request('http://print.test/api/requests?secret=hidden', { method: 'POST' }), async () =>
      Response.json({ ok: true }, { status: 201 }),
    )

    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'http_request',
        method: 'POST',
        path: '/api/requests',
        status: 201,
        durationMs: expect.any(Number),
      }),
      'request completed',
    )
    logged.mockRestore()
  })

  it('does not log health checks', async () => {
    const logged = vi.spyOn(logger, 'info').mockImplementation(() => logger)

    await withRequestContext(new Request('http://print.test/api/health'), async () => Response.json({ ok: true }))

    expect(logged).not.toHaveBeenCalled()
    logged.mockRestore()
  })
})
