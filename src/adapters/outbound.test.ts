import http from 'node:http'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertPublicEndpoint, guardedAgents, publicAddress } from './outbound'

describe('public addresses', () => {
  it.each(['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888'])('allows %s', (address) => {
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
  ])('blocks %s', (address) => {
    expect(publicAddress(address)).toBe(false)
  })
})

describe('public endpoints', () => {
  it('rejects an endpoint at a private address', () => {
    expect(() => assertPublicEndpoint('http://169.254.169.254/latest')).toThrow('private network')
  })

  it('rejects a bracketed private IPv6 endpoint', () => {
    expect(() => assertPublicEndpoint('http://[::1]:9000')).toThrow('private network')
  })

  it('rejects a localhost endpoint', () => {
    expect(() => assertPublicEndpoint('https://localhost:9000')).toThrow('private network')
  })

  it('leaves a hostname for the connection guard to resolve', () => {
    expect(() => assertPublicEndpoint('https://s3.example.com')).not.toThrow()
  })
})

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
    await expect(get(`http://localhost:${port}/`)).rejects.toThrow('private network')
  })

  it('refuses a literal private address', async () => {
    await expect(get(`http://127.0.0.1:${port}/`)).rejects.toThrow('private network')
  })

  it('refuses an HTTPS hostname that resolves to a private address', async () => {
    await expect(getHttps(`https://localhost:${port}/`)).rejects.toThrow('private network')
  })

  it('refuses an HTTPS literal private address', async () => {
    await expect(getHttps(`https://127.0.0.1:${port}/`)).rejects.toThrow('private network')
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
