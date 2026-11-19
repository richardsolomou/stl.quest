import type { NitroApp } from 'nitro/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import basePath, { withPathname } from './basePath'

afterEach(() => vi.unstubAllEnvs())

async function servedPath(url: string) {
  let seen = ''
  const nitro = {
    fetch: (request: Request) => {
      seen = new URL(request.url).pathname
      return new Response()
    },
  } as unknown as NitroApp & { hooks: NonNullable<NitroApp['hooks']> }
  basePath(nitro)
  await nitro.fetch(new Request(url))
  return seen
}

describe('base path plugin', () => {
  it('removes the base path before Nitro routes a request', async () => {
    vi.stubEnv('BASE_PATH', '/stlquest')
    expect(await servedPath('http://localhost/stlquest/assets/app.js')).toBe('/assets/app.js')
  })

  it('serves a request without the base path unchanged', async () => {
    vi.stubEnv('BASE_PATH', '/stlquest')
    expect(await servedPath('http://localhost/api/health')).toBe('/api/health')
  })

  it('leaves requests alone without a base path', async () => {
    expect(await servedPath('http://localhost/stlquest/assets/app.js')).toBe('/stlquest/assets/app.js')
  })

  it('refuses to start with an invalid base path', async () => {
    vi.stubEnv('BASE_PATH', 'https://example.com/stlquest')
    await expect(servedPath('http://localhost/')).rejects.toThrow('BASE_PATH')
  })
})

describe('withPathname', () => {
  it('keeps the query', () => {
    expect(withPathname(new Request('http://localhost/a?x=1'), '/b').url).toBe('http://localhost/b?x=1')
  })

  it('keeps the body', async () => {
    const request = new Request('http://localhost/a', { method: 'POST', body: 'payload' })
    expect(await withPathname(request, '/b').text()).toBe('payload')
  })
})
