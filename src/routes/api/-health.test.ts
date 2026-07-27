import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

it('stays healthy when workspace storage is unavailable', async () => {
  const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-health-'))
  process.env.DATA_DIR = path.join(temporary, 'data')
  const unavailableStorage = path.join(temporary, 'unavailable')
  await fs.promises.writeFile(unavailableStorage, 'not a directory')
  const { DrizzleRepository } = await import('../../db/repository')
  const seed = await DrizzleRepository.open(path.join(process.env.DATA_DIR, 'stlquest.sqlite'))
  await seed.setSetting('storage', { adapter: 'local', root: unavailableStorage })
  await seed.close()
  const { healthResponse } = await import('./health')

  const response = await healthResponse()

  expect(response).toMatchObject({ status: 200 })
  await fs.promises.rm(temporary, { recursive: true, force: true })
})

afterEach(async () => {
  delete process.env.DATA_DIR
  const singleton = globalThis as typeof globalThis & { __stlquest?: Promise<{ close(): Promise<void> }> }
  const running = singleton.__stlquest
  delete singleton.__stlquest
  if (running) await (await running.catch(() => undefined))?.close()
  vi.resetModules()
})
