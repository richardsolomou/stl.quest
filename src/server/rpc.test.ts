import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from './logger'
import { mutationRpc, rpc } from './rpc'
import { withServerFunction } from './serverFunction'

const ambient = vi.hoisted(() => ({ request: undefined as Request | undefined }))
vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () => {
    if (!ambient.request) throw new Error('no request context')
    return ambient.request
  },
}))

let logged: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  logged = vi.spyOn(logger, 'error').mockImplementation(() => logger)
})
afterEach(() => {
  ambient.request = undefined
  vi.restoreAllMocks()
})

describe('rpc', () => {
  it('returns the result of its work', async () => {
    await expect(rpc(() => 'loaded')).resolves.toBe('loaded')
  })

  it('turns a thrown response into an error carrying its body', async () => {
    await expect(rpc(() => Promise.reject(new Response('not found', { status: 404 })))).rejects.toThrow('not found')
  })

  it('leaves a client error response unreported', async () => {
    await expect(rpc(() => Promise.reject(new Response('sign in first', { status: 401 })))).rejects.toThrow('sign in first')
    expect(logged).not.toHaveBeenCalled()
  })

  it('reports a server error response with its status', async () => {
    await expect(rpc(() => Promise.reject(new Response('upstream unavailable', { status: 502 })))).rejects.toThrow('upstream unavailable')
    expect(logged).toHaveBeenCalledWith(expect.objectContaining({ event: 'server_function_failed', status: 502 }), 'server function failed')
  })

  it('reports an unexpected failure with the request and server function', async () => {
    ambient.request = new Request('https://app.example/_serverFn/abc', { method: 'POST' })
    const failure = new Error('broken')
    await expect(withServerFunction({ name: 'saveNote', filename: 'notes.ts' }, () => rpc(() => Promise.reject(failure)))).rejects.toBe(
      failure,
    )
    expect(logged).toHaveBeenCalledWith(
      { err: failure, event: 'server_function_failed', method: 'POST', path: '/_serverFn/abc', function: 'saveNote' },
      'server function failed',
    )
  })
})

describe('mutationRpc', () => {
  it('runs work for a same-origin request', async () => {
    ambient.request = new Request('https://app.example/action', { method: 'POST', headers: { origin: 'https://app.example' } })
    await expect(mutationRpc(() => 'saved')).resolves.toBe('saved')
  })

  it('rejects a cross-origin request before running work', async () => {
    const work = vi.fn()
    const request = new Request('https://app.example/action', { method: 'POST', headers: { origin: 'https://attacker.example' } })
    await expect(mutationRpc(work, request)).rejects.toThrow('cross-origin mutation rejected')
    expect(work).not.toHaveBeenCalled()
  })

  it('rejects when no request is available', async () => {
    await expect(mutationRpc(() => 'saved')).rejects.toThrow('mutation request is unavailable')
  })
})
