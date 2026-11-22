import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const token = `stlq_spoolman_${'b'.repeat(43)}`
const finished = { event: 'print_complete', printer: 'X2D', filename: 'SQ-1 Hull', duration: '1h 5m', filament_grams: '20.0', run_id: '3' }
let temporary: string

async function ingest() {
  const { receiveBambuddyRequest, receivePrintUsageRequest } = await import('./bambuddyIngest')
  return (request: Request) =>
    (new URL(request.url).pathname === '/api/bambuddy/usage' ? receivePrintUsageRequest : receiveBambuddyRequest)(request).catch(
      (error: unknown) => {
        if (error instanceof Response) return error
        throw error
      },
    )
}

const usage = (body: object) => post(JSON.stringify(body), {}, 'http://localhost/api/bambuddy/usage')

function post(body: string, headers: Record<string, string> = {}, url = 'http://localhost/api/bambuddy/events') {
  return new Request(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
    body,
  })
}

async function storedPrints() {
  const { app, hashToken } = await import('./app')
  return await (await (await app()).spoolmanWorkspace(hashToken(token))).repository.listPrintJobs()
}

describe('Bambuddy ingest', () => {
  beforeEach(async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-bambuddy-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const { DrizzleRepository } = await import('../db/repository')
    const { hashToken } = await import('./app')
    const seed = await DrizzleRepository.open(path.join(process.env.DATA_DIR, 'stlquest.sqlite'))
    await seed.connectSpoolman(hashToken(token), Date.now())
    await seed.close()
  })

  afterEach(async () => {
    delete process.env.DATA_DIR
    await (await import('./app')).resetApp()
    vi.resetModules()
    await fs.promises.rm(temporary, { recursive: true, force: true })
  })

  it('keeps a print sent with the workspace token', async () => {
    const response = await (await ingest())(post(JSON.stringify(finished)))

    expect({ status: response.status, prints: (await storedPrints()).map(({ outcome, minutes }) => ({ outcome, minutes })) }).toEqual({
      status: 204,
      prints: [{ outcome: 'finished', minutes: 65 }],
    })
  })

  it('accepts and drops a test notification', async () => {
    const response = await (await ingest())(post(JSON.stringify({ event: 'test', title: 'Bambuddy Test', source: 'Bambuddy' })))

    expect({ status: response.status, prints: await storedPrints() }).toEqual({ status: 204, prints: [] })
  })

  it('refuses a request without a token', async () => {
    const response = await (await ingest())(post(JSON.stringify(finished), { authorization: '' }))

    expect(response.status).toBe(401)
  })

  it('refuses a token that no workspace has', async () => {
    const response = await (await ingest())(post(JSON.stringify(finished), { authorization: `Bearer stlq_spoolman_${'c'.repeat(43)}` }))

    expect(response.status).toBe(401)
  })

  it('refuses a body that is not a notification', async () => {
    const response = await (await ingest())(post(JSON.stringify({ printer: 'X2D' })))

    expect(response.status).toBe(400)
  })

  it('refuses a body that is not JSON', async () => {
    const response = await (await ingest())(post(JSON.stringify(finished), { 'content-type': 'text/plain' }))

    expect(response.status).toBe(415)
  })

  it('keeps what a print used per Spoolman spool', async () => {
    const receive = await ingest()
    await receive(post(JSON.stringify(finished)))

    const response = await receive(usage({ run_id: '3', spools: [{ spool_id: 4, grams: 12.5 }] }))

    expect({ status: response.status, usage: (await storedPrints())[0].filamentUsage }).toEqual({
      status: 204,
      usage: [{ spoolId: 4, grams: 12.5 }],
    })
  })

  it('asks the bridge to send spools again for a print not received yet', async () => {
    const response = await (await ingest())(usage({ run_id: '9', spools: [{ spool_id: 4, grams: 1 }] }))

    expect(response.status).toBe(404)
  })

  it('keeps taking Bambuddy’s notifications once the bridge used up its own limit', async () => {
    const receive = await ingest()
    for (let sent = 0; sent < 61; sent++) await receive(usage({ run_id: '9', spools: [{ spool_id: 4, grams: 1 }] }))

    const response = await receive(post(JSON.stringify(finished)))

    expect(response.status).toBe(204)
  })

  it('refuses spools sent without a run', async () => {
    const response = await (await ingest())(usage({ spools: [{ spool_id: 4, grams: 1 }] }))

    expect(response.status).toBe(400)
  })
})
