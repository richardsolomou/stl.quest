import { describe, expect, it, vi } from 'vitest'
import { fetchSpools, readConfig, RetryLater, sendSpools, slimSpool, websocketUrl, type Config } from './bridge'

const environment = { SPOOLMAN_URL: 'http://spoolman:7912/', STLQUEST_URL: 'https://stl.quest/', STLQUEST_TOKEN: 'stlq_spoolman_token' }
const config: Config = readConfig(environment)

describe('readConfig', () => {
  it('sends to the ingest endpoint under STL Quest’s address', () => {
    expect(readConfig({ ...environment, STLQUEST_URL: 'https://prints.example.com/stlquest/' }).ingestUrl).toBe(
      'https://prints.example.com/stlquest/api/spoolman/spools',
    )
  })

  it('refuses plain HTTP to another host, which would send the token in the clear', () => {
    expect(() => readConfig({ ...environment, STLQUEST_URL: 'http://stl.quest' })).toThrow(/https/)
  })

  it('allows plain HTTP to STL Quest on a trusted network when asked', () => {
    expect(readConfig({ ...environment, STLQUEST_URL: 'http://nas.lan:3000', STLQUEST_ALLOW_HTTP: 'true' }).ingestUrl).toBe(
      'http://nas.lan:3000/api/spoolman/spools',
    )
  })

  it('allows plain HTTP to STL Quest on this machine', () => {
    expect(readConfig({ ...environment, STLQUEST_URL: 'http://[::1]:3000' }).ingestUrl).toBe('http://[::1]:3000/api/spoolman/spools')
  })

  it('requires the token', () => {
    expect(() => readConfig({ ...environment, STLQUEST_TOKEN: ' ' })).toThrow(/STLQUEST_TOKEN/)
  })
})

describe('websocketUrl', () => {
  it('listens to every resource under Spoolman’s base path', () => {
    expect(websocketUrl('https://home.lan/spoolman')).toBe('wss://home.lan/spoolman/api/v1/')
  })
})

describe('slimSpool', () => {
  it('keeps only what STL Quest reads', () => {
    expect(
      slimSpool({
        id: 3,
        remaining_weight: 640,
        archived: false,
        location: 'AMS 1',
        filament: { id: 9, name: 'Black', material: 'PLA', density: 1.24, vendor: { id: 1, name: 'Bambu Lab' } },
      } as never),
    ).toEqual({
      id: 3,
      remaining_weight: 640,
      archived: false,
      filament: { id: 9, name: 'Black', material: 'PLA', vendor: { name: 'Bambu Lab' } },
    })
  })
})

describe('fetchSpools', () => {
  it('includes archived spools, so STL Quest stops counting them', async () => {
    const fetcher = vi.fn(async () => Response.json([]))

    await fetchSpools(config, fetcher)

    expect(fetcher).toHaveBeenCalledWith('http://spoolman:7912/api/v1/spool?allow_archived=true', expect.anything())
  })
})

describe('sendSpools', () => {
  it('sends the spools with the token', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 204 }))

    await sendSpools(config, [], fetcher)

    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: { authorization: 'Bearer stlq_spoolman_token' },
      body: '{"spools":[]}',
    })
  })

  it('waits as long as STL Quest asks', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 429, headers: { 'retry-after': '20' } }))

    await expect(sendSpools(config, [], fetcher)).rejects.toEqual(new RetryLater(20_000))
  })

  it('says to replace a refused token', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 401 }))

    await expect(sendSpools(config, [], fetcher)).rejects.toThrow(/new one/)
  })
})
