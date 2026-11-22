import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const token = `stlq_spoolman_${'a'.repeat(43)}`
const spool = { id: 4, remaining_weight: 812, archived: false, filament: { id: 2, material: 'PLA', vendor: { name: 'Bambu Lab' } } }
let temporary: string

/** The route answers a thrown Response through `withRequestContext`, as this does. */
async function ingest() {
  const { receiveSpoolmanRequest } = await import('./spoolmanIngest')
  return (request: Request) =>
    receiveSpoolmanRequest(request).catch((error: unknown) => {
      if (error instanceof Response) return error
      throw error
    })
}

function post(body: string, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/spoolman/spools', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
    body,
  })
}

async function storedSpools() {
  const { app, hashToken } = await import('./app')
  return await (await (await app()).spoolmanWorkspace(hashToken(token))).repository.listSpoolmanSpools()
}

describe('Spoolman ingest', () => {
  beforeEach(async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-spoolman-'))
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

  it('stores the spools sent with the workspace token', async () => {
    const response = await (await ingest())(post(JSON.stringify({ spools: [spool] })))

    expect({ status: response.status, spools: (await storedSpools()).map(({ id }) => id) }).toEqual({ status: 204, spools: [4] })
  })

  it('refuses a request without a token', async () => {
    const response = await (await ingest())(post(JSON.stringify({ spools: [spool] }), { authorization: '' }))

    expect(response.status).toBe(401)
  })

  it('refuses a token no workspace holds', async () => {
    const response = await (await ingest())(post('{}', { authorization: `Bearer stlq_spoolman_${'b'.repeat(43)}` }))

    expect(response.status).toBe(401)
  })

  it('refuses a body that is not JSON', async () => {
    const response = await (await ingest())(post('spools', { 'content-type': 'text/plain' }))

    expect(response.status).toBe(415)
  })

  it('refuses a body over the size limit before parsing it', async () => {
    const response = await (await ingest())(post(' '.repeat(2 * 1024 * 1024 + 1)))

    expect(response.status).toBe(413)
  })

  it('refuses a body that is not Spoolman spools', async () => {
    const response = await (await ingest())(post(JSON.stringify({ spools: [{ id: 'x' }] })))

    expect(response.status).toBe(400)
  })

  it('slows a token that sends too often', async () => {
    const receive = await ingest()
    for (let sent = 0; sent < 60; sent++) await receive(post(JSON.stringify({ spools: [] })))

    const response = await receive(post(JSON.stringify({ spools: [] })))

    expect(response.status).toBe(429)
  })
})
