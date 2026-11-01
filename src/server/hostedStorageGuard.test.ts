import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildAssetStore } from './app'

describe('hosted workspace storage', () => {
  let server: http.Server
  let port: number

  beforeAll(async () => {
    server = http.createServer((_request, response) => response.end())
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))
  afterEach(() => vi.unstubAllEnvs())

  it('keeps S3 requests off the hosting network', async () => {
    vi.stubEnv('STLQUEST_HOSTED', 'true')
    const store = await buildAssetStore({
      adapter: 's3',
      endpoint: `http://localhost:${port}`,
      region: 'us-east-1',
      bucket: 'prints',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      forcePathStyle: true,
    })

    await expect(store.read('model.stl')).rejects.toThrow('private network')
  })

  it('keeps WebDAV requests off the hosting network', async () => {
    vi.stubEnv('STLQUEST_HOSTED', 'true')
    const store = await buildAssetStore({
      adapter: 'webdav',
      endpoint: `http://localhost:${port}/dav`,
      root: 'stlquest',
      username: 'user',
      password: 'secret',
    })

    await expect(store.read('model.stl')).rejects.toThrow('private network')
  })
})
