import { describe, expect, it, vi } from 'vitest'
import {
  addRestock,
  fetchSpools,
  readConfig,
  RetryLater,
  runSpools,
  sendPrintUsage,
  sendSlicedFiles,
  sendSpools,
  slimSpool,
  syncPrints,
  MAX_SLICED_FILE_BYTES,
  syncRestocks,
  websocketUrl,
  type BambuddyRun,
  type BambuddyUsage,
  type Config,
} from './bridge'

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

  it('reads Bambuddy only when it is given an address', () => {
    expect(config.bambuddy).toBeUndefined()
  })

  it('reads Bambuddy with its API key', () => {
    expect(readConfig({ ...environment, BAMBUDDY_URL: 'http://bambuddy:8000/', BAMBUDDY_API_KEY: 'bb_key' }).bambuddy).toEqual({
      url: 'http://bambuddy:8000',
      apiKey: 'bb_key',
      pollMs: 60_000,
    })
  })

  it('requires an API key for Bambuddy', () => {
    expect(() => readConfig({ ...environment, BAMBUDDY_URL: 'http://bambuddy:8000' })).toThrow(/BAMBUDDY_API_KEY/)
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

const json = (body: unknown, status = 200) => Response.json(body, { status })
const href = (url: string | URL | Request) => (url instanceof Request ? url.url : url.toString())
const calls = (fetcher: ReturnType<typeof vi.fn>) =>
  fetcher.mock.calls.map(([url, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${href(url as string)}`)

describe('syncRestocks', () => {
  const restock = { id: 'r1', filament_id: 2, initial_weight: 1000, comment: 'stlquest-restock:r1' }

  it('adds each waiting spool to Spoolman and reports the spool it made', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = href(url)
      if (target.endsWith('/api/spoolman/restocks') && !init?.method) return json({ restocks: [restock] })
      if (target.includes('/api/v1/spool?')) return json([])
      if (target.endsWith('/api/v1/spool')) return json({ id: 42 }, 200)
      return new Response(null, { status: 204 })
    })

    await syncRestocks(config, fetcher)

    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url, init]) => [href(url), init?.body])).toEqual([
      ['http://spoolman:7912/api/v1/spool', JSON.stringify({ filament_id: 2, initial_weight: 1000, comment: 'stlquest-restock:r1' })],
      ['https://stl.quest/api/spoolman/restocks', JSON.stringify({ id: 'r1', spool_id: 42 })],
    ])
  })

  it('says which spool it added for a restock', async () => {
    const log = vi.fn()
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = href(url)
      if (target.endsWith('/api/spoolman/restocks') && !init?.method) return json({ restocks: [restock] })
      if (target.includes('/api/v1/spool?')) return json([])
      if (target.endsWith('/api/v1/spool')) return json({ id: 42 }, 200)
      return new Response(null, { status: 204 })
    })

    await syncRestocks(config, fetcher, log)

    expect(log).toHaveBeenCalledWith('added spool #42 to Spoolman for restock r1')
  })

  it('says why Spoolman refused a restock', async () => {
    const log = vi.fn()
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = href(url)
      if (target.endsWith('/api/spoolman/restocks') && !init?.method) return json({ restocks: [restock] })
      if (target.includes('/api/v1/spool?')) return json([])
      if (target.endsWith('/api/v1/spool')) return json({ message: 'Filament not found' }, 404)
      return new Response(null, { status: 204 })
    })

    await syncRestocks(config, fetcher, log)

    expect(log).toHaveBeenCalledWith('Spoolman refused restock r1: Filament not found')
  })

  it('asks Spoolman for nothing when no spool is waiting', async () => {
    const fetcher = vi.fn(async () => json({ restocks: [] }))

    await syncRestocks(config, fetcher)

    expect(calls(fetcher)).toEqual(['GET https://stl.quest/api/spoolman/restocks'])
  })
})

describe('addRestock', () => {
  const restock = { id: 'r1', filament_id: 2, comment: 'stlquest-restock:r1' }

  it('reports a spool it already added instead of adding another', async () => {
    const fetcher = vi.fn()

    expect(await addRestock(config, restock, [{ id: 7, comment: 'Shelf · stlquest-restock:r1' }], fetcher)).toEqual({
      id: 'r1',
      spool_id: 7,
    })
  })

  it('reports why Spoolman refused a spool', async () => {
    const fetcher = vi.fn(async () => json({ message: 'Filament not found' }, 404))

    expect(await addRestock(config, restock, [], fetcher)).toEqual({ id: 'r1', error: 'Filament not found' })
  })

  it('tries again later when Spoolman is down', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 503 }))

    await expect(addRestock(config, restock, [], fetcher)).rejects.toThrow(/503/)
  })
})

describe('runSpools', () => {
  const run = (fields: Partial<BambuddyRun> = {}): BambuddyRun => ({
    id: 5,
    printer_id: 1,
    print_name: 'SQ-12 Hull',
    status: 'completed',
    completed_at: '2026-11-20T10:00:00',
    ...fields,
  })
  const usage = (fields: Partial<BambuddyUsage> = {}): BambuddyUsage => ({
    spoolman_spool_id: 3,
    printer_id: 1,
    print_name: 'SQ-12 Hull',
    weight_used: 12.5,
    created_at: '2026-11-20T10:00:04',
    ...fields,
  })

  it('gives a run the spools Bambuddy charged when it ended', () => {
    expect(runSpools([run()], [usage(), usage({ spoolman_spool_id: 4, weight_used: 2 })])).toEqual(
      new Map([
        [
          '5',
          [
            { spool_id: 3, grams: 12.5 },
            { spool_id: 4, grams: 2 },
          ],
        ],
      ]),
    )
  })

  it('adds up charges to the same spool', () => {
    expect(runSpools([run()], [usage(), usage({ weight_used: 1 })]).get('5')).toEqual([{ spool_id: 3, grams: 13.5 }])
  })

  it('gives a charge to the run that ended nearest it on the same printer', () => {
    const runs = [run(), run({ id: 6, completed_at: '2026-11-20T12:00:00' })]

    expect([...runSpools(runs, [usage({ created_at: '2026-11-20T12:00:02' })]).keys()]).toEqual(['6'])
  })

  it('leaves out a charge on another printer', () => {
    expect(runSpools([run()], [usage({ printer_id: 2 })]).size).toBe(0)
  })

  it('leaves out a charge for another print', () => {
    expect(runSpools([run()], [usage({ print_name: 'Other' })]).size).toBe(0)
  })

  it('leaves out a charge long after the run ended', () => {
    expect(runSpools([run()], [usage({ created_at: '2026-11-20T11:00:00' })]).size).toBe(0)
  })

  it('leaves out charges to spools Bambuddy keeps itself', () => {
    expect(runSpools([run()], [usage({ spoolman_spool_id: null })]).size).toBe(0)
  })
})

describe('syncPrints', () => {
  const bambuddy = readConfig({ ...environment, BAMBUDDY_URL: 'http://bambuddy:8000', BAMBUDDY_API_KEY: 'bb_key' })
  const fetcher = (answer: number) =>
    vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const target = href(url)
      if (target.includes('/api/v1/print-log/'))
        return json({
          items: [{ id: 5, printer_id: 1, print_name: 'Hull', status: 'completed', completed_at: '2026-11-20T10:00:00' }],
          total: 1,
        })
      if (target.includes('/api/v1/inventory/usage'))
        return json([{ spoolman_spool_id: 3, printer_id: 1, print_name: 'Hull', weight_used: 12.5, created_at: '2026-11-20T10:00:04' }])
      return new Response(null, { status: answer })
    })

  it('reads Bambuddy with its API key', async () => {
    const reader = fetcher(204)

    await syncPrints(bambuddy, new Map(), reader, Date.parse('2026-11-20T10:01:00Z'))

    expect(reader.mock.calls[0][1]).toMatchObject({ headers: { 'X-API-Key': 'bb_key' } })
  })

  it('sends each run’s spools to STL Quest once', async () => {
    const sent = new Map<string, string>()
    const reader = fetcher(204)

    await syncPrints(bambuddy, sent, reader, Date.parse('2026-11-20T10:01:00Z'))
    await syncPrints(bambuddy, sent, reader, Date.parse('2026-11-20T10:02:00Z'))

    expect(calls(reader).filter((call) => call.startsWith('POST'))).toEqual(['POST https://stl.quest/api/bambuddy/usage'])
  })

  it('says what it sent for each run', async () => {
    const log = vi.fn()

    await syncPrints(bambuddy, new Map(), fetcher(204), Date.parse('2026-11-20T10:01:00Z'), log)

    expect(log).toHaveBeenCalledWith('sent run 5 to STL Quest: 12.5 g from 1 spool')
  })

  it('says when STL Quest has not received a run yet', async () => {
    const log = vi.fn()

    await syncPrints(bambuddy, new Map(), fetcher(404), Date.parse('2026-11-20T10:01:00Z'), log)

    expect(log).toHaveBeenCalledWith('STL Quest has not received run 5 yet; sending it again next poll')
  })

  it('sends a run again while STL Quest has not received its print', async () => {
    const sent = new Map<string, string>()
    const reader = fetcher(404)

    await syncPrints(bambuddy, sent, reader, Date.parse('2026-11-20T10:01:00Z'))
    await syncPrints(bambuddy, sent, reader, Date.parse('2026-11-20T10:02:00Z'))

    expect(calls(reader).filter((call) => call.startsWith('POST'))).toHaveLength(2)
  })

  it('stops sending a run STL Quest never received', async () => {
    const sent = new Map<string, string>()
    const reader = fetcher(404)

    await syncPrints(bambuddy, sent, reader, Date.parse('2026-11-20T10:01:00Z'))
    await syncPrints(bambuddy, sent, reader, Date.parse('2026-11-20T11:01:00Z'))

    expect(calls(reader).filter((call) => call.startsWith('POST'))).toHaveLength(1)
  })

  it('skips runs that ended before it started', async () => {
    const reader = fetcher(204)

    await syncPrints(bambuddy, new Map(), reader, Date.parse('2026-11-20T12:00:00Z'))

    expect(calls(reader).filter((call) => call.startsWith('POST'))).toEqual([])
  })

  it('sends at most a few runs a poll', async () => {
    const runs = Array.from({ length: 15 }, (_, index) => ({
      id: index + 1,
      printer_id: index + 1,
      print_name: 'Hull',
      status: 'completed',
      completed_at: '2026-11-20T10:00:00',
    }))
    const reader = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const target = href(url)
      if (target.includes('/api/v1/print-log/')) return json({ items: runs, total: runs.length })
      if (target.includes('/api/v1/inventory/usage'))
        return json(
          runs.map(({ printer_id }) => ({
            spoolman_spool_id: 3,
            printer_id,
            print_name: 'Hull',
            weight_used: 1,
            created_at: '2026-11-20T10:00:04',
          })),
        )
      return new Response(null, { status: 204 })
    })

    await syncPrints(bambuddy, new Map(), reader, Date.parse('2026-11-20T10:01:00Z'))

    expect(calls(reader).filter((call) => call.startsWith('POST'))).toHaveLength(10)
  })
})

describe('sendPrintUsage', () => {
  it('sends a run’s spools', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 204 }))

    await sendPrintUsage(config, '5', [{ spool_id: 3, grams: 12.5 }], fetcher)

    expect(fetcher.mock.calls[0][1]?.body).toBe(JSON.stringify({ run_id: '5', spools: [{ spool_id: 3, grams: 12.5 }] }))
  })
})

describe('sendSlicedFiles', () => {
  const bambuddy = readConfig({ ...environment, BAMBUDDY_URL: 'http://bambuddy:8000', BAMBUDDY_API_KEY: 'bb_key' })
  const runs: BambuddyRun[] = [{ id: 5, archive_id: 12, plate_id: 2, status: 'completed', completed_at: '2026-11-20T10:00:00' }]
  const file = new Uint8Array([0x50, 0x4b, 3, 4, 9])
  /** Bambuddy's `GET /api/v1/archives/{id}/download` and STL Quest's `/api/bambuddy/sliced`, answering as given. */
  const fetcher = ({
    wanted = [{ run_id: '5', archive_id: '12' }] as { run_id: string; archive_id?: string }[],
    download = () => new Response(file, { headers: { 'content-length': String(file.length) } }),
    upload = 204,
  }: { wanted?: { run_id: string; archive_id?: string }[]; download?: () => Response; upload?: number } = {}) =>
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = href(url)
      if (target.startsWith('http://bambuddy:8000/api/v1/archives/')) return download()
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      if (target === 'https://stl.quest/api/bambuddy/sliced') return json({ runs: wanted })
      if (init?.body instanceof ReadableStream) await new Response(init.body).arrayBuffer()
      return new Response(null, { status: upload })
    })

  it('downloads each wanted run’s file from Bambuddy’s archive with its API key', async () => {
    const reader = fetcher()

    await sendSlicedFiles(bambuddy, runs, new Set(), reader)

    expect(reader.mock.calls[1]).toEqual([
      'http://bambuddy:8000/api/v1/archives/12/download',
      expect.objectContaining({ headers: { 'X-API-Key': 'bb_key' } }),
    ])
  })

  it('sends the file to STL Quest with its run and the plate that printed', async () => {
    const reader = fetcher()

    await sendSlicedFiles(bambuddy, runs, new Set(), reader)

    expect(calls(reader)[2]).toBe('POST https://stl.quest/api/bambuddy/sliced?run_id=5&plate=2')
  })

  it('streams the file’s bytes as they are', async () => {
    let received: Uint8Array | undefined
    const reader = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = href(url)
      if (target.startsWith('http://bambuddy:8000/')) return new Response(file)
      if (init?.method !== 'POST') return json({ runs: [{ run_id: '5', archive_id: '12' }] })
      received = new Uint8Array(await new Response(init.body).arrayBuffer())
      return new Response(null, { status: 204 })
    })

    await sendSlicedFiles(bambuddy, runs, new Set(), reader)

    expect(received).toEqual(file)
  })

  it('sends the file as bytes with the token', async () => {
    const reader = fetcher()

    await sendSlicedFiles(bambuddy, runs, new Set(), reader)

    expect(reader.mock.calls[2][1]).toMatchObject({
      headers: { authorization: 'Bearer stlq_spoolman_token', 'content-type': 'application/octet-stream' },
    })
  })

  it('uses the archive STL Quest names for a run older than the print log it read', async () => {
    const reader = fetcher()

    await sendSlicedFiles(bambuddy, [], new Set(), reader)

    expect(calls(reader).slice(1)).toEqual([
      'GET http://bambuddy:8000/api/v1/archives/12/download',
      'POST https://stl.quest/api/bambuddy/sliced?run_id=5',
    ])
  })

  it('fetches nothing while STL Quest wants no file', async () => {
    const reader = fetcher({ wanted: [] })

    await sendSlicedFiles(bambuddy, runs, new Set(), reader)

    expect(calls(reader)).toEqual(['GET https://stl.quest/api/bambuddy/sliced'])
  })

  it('fetches nothing from an STL Quest that does not take sliced files yet', async () => {
    const reader = vi.fn(async () => new Response('<html>', { status: 404 }))

    await sendSlicedFiles(bambuddy, runs, new Set(), reader)

    expect(reader).toHaveBeenCalledTimes(1)
  })

  it('stops asking Bambuddy for a file its archive does not have', async () => {
    const skipped = new Set<string>()
    const reader = fetcher({ download: () => json({ detail: 'File not found' }, 404) })

    await sendSlicedFiles(bambuddy, runs, skipped, reader)
    await sendSlicedFiles(bambuddy, runs, skipped, reader)

    expect(calls(reader).filter((call) => call.includes('bambuddy:8000'))).toHaveLength(1)
  })

  it('skips a file larger than STL Quest takes without sending it', async () => {
    const reader = fetcher({
      download: () => new Response(file, { headers: { 'content-length': String(MAX_SLICED_FILE_BYTES + 1) } }),
    })

    await sendSlicedFiles(bambuddy, runs, new Set(), reader)

    expect(calls(reader).filter((call) => call.startsWith('POST'))).toEqual([])
  })

  it('stops sending a file STL Quest could not read', async () => {
    const skipped = new Set<string>()
    const reader = fetcher({ upload: 422 })

    await sendSlicedFiles(bambuddy, runs, skipped, reader)
    await sendSlicedFiles(bambuddy, runs, skipped, reader)

    expect(calls(reader).filter((call) => call.startsWith('POST'))).toHaveLength(1)
  })

  it('tells STL Quest a file Bambuddy’s archive does not have is unavailable, so it stops asking', async () => {
    const reader = fetcher({ download: () => json({ detail: 'File not found' }, 404) })

    await sendSlicedFiles(bambuddy, runs, new Set(), reader)

    expect(calls(reader)).toContain('DELETE https://stl.quest/api/bambuddy/sliced?run_id=5')
  })

  it('tells STL Quest a run Bambuddy archived no file for is unavailable', async () => {
    const reader = fetcher({ wanted: [{ run_id: '6' }] })

    await sendSlicedFiles(bambuddy, [], new Set(), reader)

    expect(calls(reader)).toEqual(['GET https://stl.quest/api/bambuddy/sliced', 'DELETE https://stl.quest/api/bambuddy/sliced?run_id=6'])
  })

  it('tells STL Quest a file too large for it is unavailable', async () => {
    const reader = fetcher({
      download: () => new Response(file, { headers: { 'content-length': String(MAX_SLICED_FILE_BYTES + 1) } }),
    })

    await sendSlicedFiles(bambuddy, runs, new Set(), reader)

    expect(calls(reader)).toContain('DELETE https://stl.quest/api/bambuddy/sliced?run_id=5')
  })

  it('tells STL Quest a file it refused as too large is unavailable', async () => {
    const reader = fetcher({ upload: 413 })

    await sendSlicedFiles(bambuddy, runs, new Set(), reader)

    expect(calls(reader)).toContain('DELETE https://stl.quest/api/bambuddy/sliced?run_id=5')
  })

  it('leaves a file STL Quest could not read to STL Quest, which already stopped asking', async () => {
    const reader = fetcher({ upload: 422 })

    await sendSlicedFiles(bambuddy, runs, new Set(), reader)

    expect(calls(reader).filter((call) => call.startsWith('DELETE'))).toEqual([])
  })

  it('skips a run all the same on an STL Quest that cannot be told a file is unavailable', async () => {
    const skipped = new Set<string>()
    const reader = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (href(url).startsWith('http://bambuddy:8000/')) return json({ detail: 'File not found' }, 404)
      if (init?.method === 'DELETE') return new Response(null, { status: 405 })
      return json({ runs: [{ run_id: '5', archive_id: '12' }] })
    })

    await sendSlicedFiles(bambuddy, runs, skipped, reader)

    expect(skipped).toEqual(new Set(['5']))
  })

  it('moves on to the next run when STL Quest fails on one', async () => {
    const reader = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = href(url)
      if (target.startsWith('http://bambuddy:8000/')) return new Response(file)
      if (init?.method !== 'POST')
        return json({
          runs: [
            { run_id: '5', archive_id: '12' },
            { run_id: '6', archive_id: '13' },
          ],
        })
      await new Response(init.body).arrayBuffer()
      return new Response(null, { status: target.includes('run_id=5') ? 500 : 204 })
    })

    await sendSlicedFiles(bambuddy, runs, new Set(), reader)

    expect(calls(reader).filter((call) => call.startsWith('POST'))).toHaveLength(2)
  })

  it('sends a file STL Quest failed on again next poll', async () => {
    const skipped = new Set<string>()
    const reader = fetcher({ upload: 500 })

    await sendSlicedFiles(bambuddy, runs, skipped, reader)
    await sendSlicedFiles(bambuddy, runs, skipped, reader)

    expect(calls(reader).filter((call) => call.startsWith('POST'))).toHaveLength(2)
  })

  it('does not tell STL Quest a file it failed on is unavailable', async () => {
    const reader = fetcher({ upload: 503 })

    await sendSlicedFiles(bambuddy, runs, new Set(), reader)

    expect(calls(reader).filter((call) => call.startsWith('DELETE'))).toEqual([])
  })

  it('says STL Quest failed on a file', async () => {
    const log = vi.fn()

    await sendSlicedFiles(bambuddy, runs, new Set(), fetcher({ upload: 500 }), log)

    expect(log).toHaveBeenCalledWith('STL Quest answered 500 for the sliced file of run 5; sending it again next poll')
  })

  it('says a key without archive access was refused', async () => {
    const reader = fetcher({ download: () => json({ detail: 'Forbidden' }, 403) })

    await expect(sendSlicedFiles(bambuddy, runs, new Set(), reader)).rejects.toThrow(/Read Status/)
  })

  it('waits as long as STL Quest asks', async () => {
    const reader = vi.fn(async (url: string | URL | Request) =>
      new URL(href(url)).origin === 'https://stl.quest'
        ? new Response(null, { status: 429, headers: { 'retry-after': '30' } })
        : new Response(file),
    )

    await expect(sendSlicedFiles(bambuddy, runs, new Set(), reader)).rejects.toMatchObject({ delayMs: 30_000 })
  })

  it('sends at most a few files a poll', async () => {
    const reader = fetcher({ wanted: Array.from({ length: 10 }, (_, index) => ({ run_id: String(index), archive_id: String(index) })) })

    await sendSlicedFiles(bambuddy, [], new Set(), reader)

    expect(calls(reader).filter((call) => call.startsWith('POST'))).toHaveLength(3)
  })

  it('says what it sent', async () => {
    const log = vi.fn()

    await sendSlicedFiles(bambuddy, runs, new Set(), fetcher(), log)

    expect(log).toHaveBeenCalledWith('sent the sliced file of run 5 to STL Quest')
  })

  it('says why STL Quest refused a file', async () => {
    const log = vi.fn()
    const reader = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (href(url).startsWith('http://bambuddy:8000/')) return new Response(file)
      if (init?.method !== 'POST') return json({ runs: [{ run_id: '5' }] })
      return new Response('this file holds several sliced plates', { status: 422 })
    })

    await sendSlicedFiles(bambuddy, runs, new Set(), reader, log)

    expect(log).toHaveBeenCalledWith('not sending the sliced file of run 5: this file holds several sliced plates')
  })
})
