import { afterEach, describe, expect, it, vi } from 'vitest'

const { createStartHandler } = vi.hoisted(() => ({
  createStartHandler: vi.fn((_options: { transformAssets?: string }) => (request: Request) => new Response(new URL(request.url).pathname)),
}))

vi.mock('@tanstack/react-start/server', () => ({
  createStartHandler,
  createServerEntry: (entry: { fetch: (request: Request) => Response }) => entry,
  defaultStreamHandler: () => undefined,
}))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  createStartHandler.mockClear()
})

async function entryUnder(prefix: string) {
  vi.stubEnv('BASE_PATH', prefix)
  vi.stubEnv('TSS_SERVER_FN_BASE', '/_serverFn/')
  return (await import('./server')).default
}

async function startSees(prefix: string, path: string) {
  return (await (await entryUnder(prefix)).fetch(new Request(`http://localhost${path}`))).text()
}

describe('server entry', () => {
  it('gives the router the public path under a base path', async () => {
    expect(await startSees('/stlquest', '/settings')).toBe('/stlquest/settings')
  })

  it('leaves server functions at their root path', async () => {
    expect(await startSees('/stlquest', '/_serverFn/abc')).toBe('/_serverFn/abc')
  })

  it('leaves paths alone without a base path', async () => {
    expect(await startSees('', '/settings')).toBe('/settings')
  })

  it('prefixes asset links with the base path', async () => {
    await entryUnder('/stlquest')
    expect(createStartHandler.mock.calls[0][0].transformAssets).toBe('/stlquest')
  })
})
