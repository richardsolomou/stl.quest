import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const token = `stlq_spoolman_${'d'.repeat(43)}`
const restock = { id: 'r1', filamentId: 2, filamentName: 'Black', grams: 1_000, status: 'queued' as const, createdAt: 1, updatedAt: 1 }
let temporary: string

/** The route answers a thrown Response through `withRequestContext`, as this does. */
const answered = (response: Promise<Response>) =>
  response.catch((error: unknown) => {
    if (error instanceof Response) return error
    throw error
  })

async function collect(headers: Record<string, string> = {}) {
  const { sendSpoolmanRestocks } = await import('./spoolmanRestocksIngest')
  return await answered(
    sendSpoolmanRestocks(
      new Request('http://localhost/api/spoolman/restocks', { headers: { authorization: `Bearer ${token}`, ...headers } }),
    ),
  )
}

async function report(body: unknown) {
  const { receiveSpoolmanRestockResult } = await import('./spoolmanRestocksIngest')
  return await answered(
    receiveSpoolmanRestockResult(
      new Request('http://localhost/api/spoolman/restocks', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),
  )
}

async function storedRestocks() {
  const { app, hashToken } = await import('./app')
  return await (await (await app()).spoolmanWorkspace(hashToken(token))).repository.listSpoolmanRestocks()
}

describe('Spoolman restocks for the bridge', () => {
  beforeEach(async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-restocks-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const { DrizzleRepository } = await import('../db/repository')
    const { hashToken } = await import('./app')
    const seed = await DrizzleRepository.open(path.join(process.env.DATA_DIR, 'stlquest.sqlite'))
    await seed.connectSpoolman(hashToken(token), Date.now())
    await seed.queueSpoolmanRestocks([restock], 10)
    await seed.close()
  })

  afterEach(async () => {
    delete process.env.DATA_DIR
    await (await import('./app')).resetApp()
    vi.resetModules()
    await fs.promises.rm(temporary, { recursive: true, force: true })
  })

  it('hands the bridge each waiting spool as Spoolman takes it, with the comment that marks it', async () => {
    const response = await collect()

    expect(await response.json()).toEqual({
      restocks: [{ id: 'r1', filament_id: 2, initial_weight: 1_000, comment: 'stlquest-restock:r1' }],
    })
  })

  it('refuses to hand out spools without the token', async () => {
    const response = await collect({ authorization: '' })

    expect(response.status).toBe(401)
  })

  it('keeps the spool the bridge added', async () => {
    const response = await report({ id: 'r1', spool_id: 9 })

    expect({ status: response.status, stored: (await storedRestocks()).map(({ status, spoolId }) => ({ status, spoolId })) }).toEqual({
      status: 204,
      stored: [{ status: 'created', spoolId: 9 }],
    })
  })

  it('keeps why Spoolman refused a spool', async () => {
    await report({ id: 'r1', error: 'filament 2 not found' })

    expect((await storedRestocks())[0]).toMatchObject({ status: 'failed', error: 'filament 2 not found' })
  })

  it('refuses a report for a spool that is not waiting', async () => {
    const response = await report({ id: 'missing', spool_id: 9 })

    expect(response.status).toBe(404)
  })

  it('refuses a report that is neither a spool nor an error', async () => {
    const response = await report({ id: 'r1' })

    expect(response.status).toBe(400)
  })
})
