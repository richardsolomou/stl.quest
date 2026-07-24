import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DrizzleRepository } from '../repository'
import { LibSQLBackend } from './libsql'

describe('LibSQLBackend', () => {
  let directory: string | undefined

  afterEach(async () => {
    if (directory) await fs.promises.rm(directory, { recursive: true, force: true })
  })

  it('runs the shared SQLite migrations and repository contract over libSQL', async () => {
    directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-libsql-'))
    const repository = await DrizzleRepository.create(LibSQLBackend.open(`file:${path.join(directory, 'database.sqlite')}`))

    expect(await repository.databaseInfo()).toMatchObject({ integrity: 'ok', sizeBytes: 0 })
    expect(await repository.listWorkspaces()).toEqual([])
    repository.close()
  })

  it('directs backups to the remote database provider', async () => {
    directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-libsql-'))
    const backend = LibSQLBackend.open(`file:${path.join(directory, 'database.sqlite')}`)

    await expect(backend.backup('/tmp/backup.sqlite')).rejects.toThrow('database provider')
    backend.close()
  })

  it.skipIf(!process.env.TURSO_TEST_URL)('connects to a real Turso database', async () => {
    const repository = await DrizzleRepository.create(LibSQLBackend.open(process.env.TURSO_TEST_URL!, process.env.TURSO_TEST_AUTH_TOKEN))

    expect(await repository.maintain()).toMatchObject({ integrity: 'ok' })
    repository.close()
  })
})
