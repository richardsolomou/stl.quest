import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { forwardToPostHog } from './posthogProxy'

type Received = { host: string; method: string; url: string; headers: IncomingHttpHeaders; body: string }

const received: Received[] = []
const servers: Server[] = []
let environment: { host: string; assetsHost: string }

function upstream(name: string) {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      received.push({
        host: name,
        method: request.method!,
        url: request.url!,
        headers: request.headers,
        body: Buffer.concat(chunks).toString(),
      })
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'set-cookie': 'tracker=1; Path=/',
      })
      response.end(gzipSync(JSON.stringify({ status: 1 })))
    })
  })
  servers.push(server)
  return new Promise<string>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
  )
}

beforeAll(async () => {
  environment = { host: await upstream('ingestion'), assetsHost: await upstream('assets') }
})
afterAll(() => Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve)))))
beforeEach(() => {
  received.length = 0
})

function proxied(path: string, init: RequestInit = {}) {
  return forwardToPostHog(new Request(`https://app.example${path}`, init), environment)
}

describe('forwardToPostHog', () => {
  it('sends events to the ingestion host without the proxy path', async () => {
    await proxied('/t/e/?compression=gzip-js', { method: 'POST', body: 'payload' })
    expect(received.map(({ host, method, url, body }) => ({ host, method, url, body }))).toEqual([
      { host: 'ingestion', method: 'POST', url: '/e/?compression=gzip-js', body: 'payload' },
    ])
  })

  it.each(['/t/static/recorder.js', '/t/array/phc_test/config.js'])('sends %s to the assets host', async (path) => {
    await proxied(path)
    expect(received.map(({ host, url }) => [host, url])).toEqual([['assets', path.slice(2)]])
  })

  it('keeps the session cookie and bearer token from PostHog', async () => {
    await proxied('/t/flags/?v=2', { method: 'POST', body: '{}', headers: { cookie: 'session=secret', authorization: 'Bearer secret' } })
    expect(Object.keys(received[0]!.headers).filter((name) => name === 'cookie' || name === 'authorization')).toEqual([])
  })

  it('addresses the request to the upstream host', async () => {
    await proxied('/t/e/', { method: 'POST', body: 'payload', headers: { host: 'app.example' } })
    expect(received[0]!.headers.host).toBe(new URL(environment.host).host)
  })

  it('forwards the client address it received', async () => {
    await proxied('/t/e/', { method: 'POST', body: 'payload', headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.2' } })
    expect(received[0]!.headers['x-forwarded-for']).toBe('203.0.113.7, 10.0.0.2')
  })

  it("names Cloudflare's client address as the forwarded one", async () => {
    await proxied('/t/e/', {
      method: 'POST',
      body: 'payload',
      headers: { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' },
    })
    expect(received[0]!.headers['x-forwarded-for']).toBe('203.0.113.7')
  })

  it("leaves Cloudflare's own headers behind", async () => {
    await proxied('/t/e/', { method: 'POST', body: 'payload', headers: { 'cf-connecting-ip': '203.0.113.7', 'cf-ray': 'abc' } })
    expect(Object.keys(received[0]!.headers).filter((name) => name.startsWith('cf-'))).toEqual([])
  })

  it('returns the decoded upstream body without its encoding', async () => {
    const response = await proxied('/t/flags/?v=2', { method: 'POST', body: '{}' })
    expect([response.headers.get('content-encoding'), await response.json()]).toEqual([null, { status: 1 }])
  })

  it('drops cookies PostHog tries to set on this origin', async () => {
    const response = await proxied('/t/e/', { method: 'POST', body: 'payload' })
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})
