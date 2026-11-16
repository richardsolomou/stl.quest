import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { healthResponse } from './health'
import { logger } from './logger'

beforeEach(() => {
  vi.spyOn(logger, 'warn').mockImplementation(() => logger)
})
afterEach(() => vi.restoreAllMocks())

it('reports a passing check without letting caches keep it', async () => {
  const response = await healthResponse(() => undefined)
  expect({ status: response.status, cache: response.headers.get('cache-control'), body: await response.json() }).toEqual({
    status: 200,
    cache: 'no-store',
    body: { ok: true },
  })
})

it('reports a failed check as unavailable without exposing the cause', async () => {
  const response = await healthResponse(() => Promise.reject(new Error('password=secret')))
  expect({ status: response.status, body: await response.json() }).toEqual({
    status: 503,
    body: { ok: false, error: 'health check failed' },
  })
})

it('reports the stable code a failure maps to', async () => {
  const response = await healthResponse(
    () => Promise.reject(new Error('password=secret')),
    () => ({ code: 'database_unavailable', message: 'database unavailable' }),
  )
  expect(await response.json()).toEqual({ ok: false, error: 'database unavailable', code: 'database_unavailable' })
})
