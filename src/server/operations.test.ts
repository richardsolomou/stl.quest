import fs from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DrizzleRepository } from '../db/repository'
import { assertUploadCapacity, filesystemCapacity, systemDiagnostics } from './operations'

describe('operational disk safeguards', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reports filesystem byte capacity', async () => {
    vi.spyOn(fs.promises, 'statfs').mockResolvedValue({ blocks: 100n, bavail: 25n, bsize: 4096n } as Awaited<
      ReturnType<typeof fs.promises.statfs>
    >)
    await expect(filesystemCapacity('/data')).resolves.toEqual({ totalBytes: 409_600, freeBytes: 102_400 })
  })

  it('reserves upload bytes plus a safety margin', async () => {
    const statfs = vi.spyOn(fs.promises, 'statfs')
    statfs.mockResolvedValueOnce({ blocks: 1n, bavail: 400n, bsize: 1024n * 1024n } as Awaited<ReturnType<typeof fs.promises.statfs>>)
    await expect(assertUploadCapacity('/data/uploads/probe.part', 100 * 1024 * 1024)).resolves.toBeUndefined()
    statfs.mockResolvedValueOnce({ blocks: 1n, bavail: 300n, bsize: 1024n * 1024n } as Awaited<ReturnType<typeof fs.promises.statfs>>)
    await expect(assertUploadCapacity('/data/uploads/probe.part', 100 * 1024 * 1024)).rejects.toMatchObject({ status: 507 })
  })

  it('does not inspect filesystem capacity for a remote database', async () => {
    const statfs = vi.spyOn(fs.promises, 'statfs')
    const repository = {
      databaseInfo: async () => ({
        location: { kind: 'remote', display: 'postgres://database.example.com/stlquest' },
        integrity: 'ok',
        lastCheckedAt: 1,
      }),
    } as DrizzleRepository

    await expect(systemDiagnostics(repository)).resolves.toMatchObject({ dataCapacity: undefined })
    expect(statfs).not.toHaveBeenCalled()
  })
})
