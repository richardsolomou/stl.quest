import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acquireDataDirectoryLease } from './dataSafety'

describe('data directory safety', () => {
  let temporary: string | undefined

  afterEach(async () => {
    if (temporary) await fs.promises.rm(temporary, { recursive: true, force: true })
  })

  it('allows exactly one live process lease and releases it cleanly', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-lock-'))
    const directory = temporary
    const lease = acquireDataDirectoryLease(directory)
    expect(() => acquireDataDirectoryLease(directory)).toThrow('another PrintHub process')
    lease.release()
    const replacement = acquireDataDirectoryLease(temporary)
    replacement.release()
    await expect(fs.promises.stat(path.join(temporary, 'printhub.lock'))).resolves.toMatchObject({ isFile: expect.any(Function) })
  })

  it('releases the operating system lock idempotently', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-lock-'))
    const lease = acquireDataDirectoryLease(temporary)
    lease.release()
    expect(() => lease.release()).not.toThrow()
    const replacement = acquireDataDirectoryLease(temporary)
    replacement.release()
  })
})
