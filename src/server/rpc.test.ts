import { afterEach, describe, expect, it, vi } from 'vitest'
import { logger } from './logger'
import { rpc } from './rpc'

describe('server function errors', () => {
  afterEach(() => vi.restoreAllMocks())

  it('logs unexpected failures before rethrowing them', async () => {
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => logger)
    const failure = new Error('database failed')

    await expect(rpc(() => Promise.reject(failure))).rejects.toBe(failure)

    expect(logged).toHaveBeenCalledWith({ err: failure, event: 'server_function_failed' }, 'server function failed')
  })

  it('returns expected HTTP failures without reporting an exception', async () => {
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => logger)

    await expect(rpc(() => Promise.reject(new Response('workspace not found', { status: 404 })))).rejects.toThrow('workspace not found')

    expect(logged).not.toHaveBeenCalled()
  })
})
