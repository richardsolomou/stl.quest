import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { assertPublicEndpoint, guardedAgents, PrivateNetworkError, publicAddress, resolvePublicAddress } from './outbound'

describe('public addresses', () => {
  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '2001:4860:4860::8888',
    '172.15.255.255',
    '172.32.0.0',
    '100.63.255.255',
    '100.128.0.0',
    '::ffff:8.8.8.8',
  ])('allows %s', (address) => {
    expect(publicAddress(address)).toBe(true)
  })

  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fc00::1',
    'fe80::1',
    '::ffff:10.0.0.1',
    '::ffff:7f00:1',
    '172.31.255.255',
    '100.127.255.255',
    '64:ff9b::a00:1',
  ])('blocks %s', (address) => {
    expect(publicAddress(address)).toBe(false)
  })
})

describe('public endpoints', () => {
  it('rejects an endpoint at a private address', () => {
    expect(() => assertPublicEndpoint('http://169.254.169.254/latest')).toThrow('public internet address')
  })

  it('rejects a bracketed private IPv6 endpoint', () => {
    expect(() => assertPublicEndpoint('http://[::1]:9000')).toThrow('public internet address')
  })

  it('rejects a localhost endpoint', () => {
    expect(() => assertPublicEndpoint('https://localhost:9000')).toThrow('public internet address')
  })

  it('rejects a localhost subdomain endpoint', () => {
    expect(() => assertPublicEndpoint('https://storage.localhost')).toThrow('public internet address')
  })

  it('leaves a hostname for the connection guard to resolve', () => {
    expect(() => assertPublicEndpoint('https://s3.example.com')).not.toThrow()
  })
})

describe('resolving public addresses', () => {
  it('returns a public literal address unchanged', async () => {
    await expect(resolvePublicAddress('8.8.8.8')).resolves.toBe('8.8.8.8')
  })

  it('rejects a private literal address', async () => {
    await expect(resolvePublicAddress('10.0.0.5')).rejects.toThrow('public internet address')
  })

  it('rejects a hostname that resolves to a private address', async () => {
    await expect(resolvePublicAddress('localhost')).rejects.toThrow('public internet address')
  })

  it('rejects a hostname that does not exist the same way as a private one', async () => {
    vi.spyOn(dns.promises, 'lookup').mockRejectedValue(lookupFailure('ENOTFOUND'))
    await expect(resolvePublicAddress('redis')).rejects.toBeInstanceOf(PrivateNetworkError)
  })

  it('keeps a temporary lookup failure distinct', async () => {
    vi.spyOn(dns.promises, 'lookup').mockRejectedValue(lookupFailure('EAI_AGAIN'))
    await expect(resolvePublicAddress('smtp.example.com')).rejects.toThrow('EAI_AGAIN')
  })
})

afterEach(() => vi.restoreAllMocks())

function lookupFailure(code: string) {
  return Object.assign(new Error(`getaddrinfo ${code}`), { code })
}

describe('guarded agents', () => {
  let server: http.Server
  let port: number

  beforeAll(async () => {
    server = http.createServer((_request, response) => response.end('internal'))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

  it('refuses a hostname that resolves to a private address', async () => {
    await expect(get(`http://localhost:${port}/`)).rejects.toThrow('public internet address')
  })

  it('refuses a literal private address', async () => {
    await expect(get(`http://127.0.0.1:${port}/`)).rejects.toThrow('public internet address')
  })

  it('refuses a hostname that does not exist the same way as a private one', async () => {
    vi.spyOn(dns, 'lookup').mockImplementation(((_hostname: string, _options: unknown, callback: (error: Error) => void) =>
      callback(lookupFailure('ENOTFOUND'))) as unknown as typeof dns.lookup)
    await expect(get(`http://redis:${port}/`)).rejects.toThrow('public internet address')
  })

  it('refuses an HTTPS hostname that resolves to a private address', async () => {
    await expect(getHttps(`https://localhost:${port}/`)).rejects.toThrow('public internet address')
  })

  it('refuses an HTTPS literal private address', async () => {
    await expect(getHttps(`https://127.0.0.1:${port}/`)).rejects.toThrow('public internet address')
  })

  it('connects without the guard', async () => {
    await expect(get(`http://127.0.0.1:${port}/`, new http.Agent())).resolves.toBe('internal')
  })
})

function get(url: string, agent: http.Agent = guardedAgents().httpAgent) {
  return new Promise<string>((resolve, reject) => {
    http
      .get(url, { agent }, (response) => {
        let body = ''
        response.on('data', (chunk) => (body += chunk))
        response.on('end', () => resolve(body))
      })
      .on('error', reject)
  })
}

function getHttps(url: string) {
  return new Promise<void>((resolve, reject) => {
    https.get(url, { agent: guardedAgents().httpsAgent }, () => resolve()).on('error', reject)
  })
}
