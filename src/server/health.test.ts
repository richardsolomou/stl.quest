import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { checkDependency, healthResponse } from './health'
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

it('reports the stable code of a failed dependency', async () => {
  const response = await healthResponse(() =>
    checkDependency('database_unavailable', 'database unavailable', () => Promise.reject(new Error('password=secret'))),
  )
  expect(await response.json()).toEqual({ ok: false, error: 'database unavailable', code: 'database_unavailable' })
})

it('does not blame a dependency for a failure outside its check', async () => {
  // As `app()` throws for a missing secret before any dependency is checked.
  const missingSecret = (): { ping: () => void } => {
    throw new Error('BETTER_AUTH_SECRET is required in production')
  }
  const response = await healthResponse(() => {
    const database = missingSecret()
    return checkDependency('database_unavailable', 'database unavailable', () => database.ping())
  })
  expect(await response.json()).toEqual({ ok: false, error: 'health check failed' })
})
