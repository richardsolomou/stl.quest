import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execute = promisify(execFile)

describe('Convex migration scripts', () => {
  let temporary: string | undefined

  afterEach(async () => {
    if (temporary) await fs.promises.rm(temporary, { recursive: true, force: true })
  })

  it('imports and verifies a synthetic export', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-migration-'))
    const exportDir = path.join(temporary, 'export')
    const dataDir = path.join(temporary, 'data')
    const printsDir = path.join(temporary, 'prints')
    await Promise.all([
      fs.promises.mkdir(path.join(exportDir, 'jobs'), { recursive: true }),
      fs.promises.mkdir(path.join(exportDir, 'users'), { recursive: true }),
      fs.promises.mkdir(path.join(printsDir, 'todo'), { recursive: true }),
    ])
    await fs.promises.writeFile(
      path.join(exportDir, 'users', 'documents.jsonl'),
      `${JSON.stringify({ _id: 'user', email: 'owner@example.com', name: 'Owner' })}\n`,
    )
    await fs.promises.writeFile(
      path.join(exportDir, 'jobs', 'documents.jsonl'),
      `${JSON.stringify({
        _id: 'job',
        _creationTime: 1_700_000_000_000,
        name: 'Probe',
        fileName: 'probe.stl',
        filePath: 'todo/probe.stl',
        quantity: 1,
        requesterEmail: 'owner@example.com',
        counts: { todo: 1, in_progress: 0, done: 0 },
        orders: { todo: 1 },
        createdAt: 1_700_000_000_000,
      })}\n`,
    )
    await fs.promises.writeFile(path.join(printsDir, 'todo', 'probe.stl'), 'solid probe\nendsolid probe\n')

    const environment = { ...process.env, NODE_ENV: 'test' }
    const migrated = await execute(
      process.execPath,
      ['--import', 'tsx', 'scripts/migrate-convex.ts', '--export', exportDir, '--data', dataDir, '--prints', printsDir],
      { cwd: process.cwd(), env: environment },
    )
    expect(migrated.stdout).toContain('imported 1 request(s) and 1 user(s)')

    const verified = await execute(
      process.execPath,
      ['--import', 'tsx', 'scripts/verify-convex-import.ts', '--export', exportDir, '--data', dataDir, '--prints', printsDir],
      { cwd: process.cwd(), env: environment },
    )
    expect(verified.stdout).toContain('NO METADATA MISMATCHES')
  })

  it('refuses an import when a referenced print file is missing', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-migration-'))
    const exportDir = path.join(temporary, 'export')
    const dataDir = path.join(temporary, 'data')
    const printsDir = path.join(temporary, 'prints')
    await Promise.all([
      fs.promises.mkdir(path.join(exportDir, 'jobs'), { recursive: true }),
      fs.promises.mkdir(path.join(exportDir, 'users'), { recursive: true }),
      fs.promises.mkdir(printsDir, { recursive: true }),
    ])
    await fs.promises.writeFile(path.join(exportDir, 'users', 'documents.jsonl'), '')
    await fs.promises.writeFile(
      path.join(exportDir, 'jobs', 'documents.jsonl'),
      `${JSON.stringify({
        _id: 'job',
        _creationTime: 1_700_000_000_000,
        name: 'Missing probe',
        fileName: 'missing.stl',
        filePath: 'todo/missing.stl',
        quantity: 1,
        requesterEmail: 'owner@example.com',
        counts: { todo: 1, in_progress: 0, done: 0 },
      })}\n`,
    )

    await expect(
      execute(
        process.execPath,
        ['--import', 'tsx', 'scripts/migrate-convex.ts', '--export', exportDir, '--data', dataDir, '--prints', printsDir],
        { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'test' } },
      ),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('missing 1 referenced print file') })
    await expect(fs.promises.access(path.join(dataDir, 'printhub.sqlite'))).rejects.toThrow()
  })

  it('returns a failure status when verification finds a mismatch', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-migration-'))
    const exportDir = path.join(temporary, 'export')
    const dataDir = path.join(temporary, 'data')
    const printsDir = path.join(temporary, 'prints')
    await Promise.all([
      fs.promises.mkdir(path.join(exportDir, 'jobs'), { recursive: true }),
      fs.promises.mkdir(path.join(exportDir, 'users'), { recursive: true }),
      fs.promises.mkdir(path.join(printsDir, 'todo'), { recursive: true }),
    ])
    await fs.promises.writeFile(path.join(exportDir, 'users', 'documents.jsonl'), '')
    await fs.promises.writeFile(path.join(exportDir, 'jobs', 'documents.jsonl'), '')
    await fs.promises.writeFile(path.join(printsDir, 'todo', 'unexpected.stl'), 'solid probe\nendsolid probe\n')

    await execute(
      process.execPath,
      ['--import', 'tsx', 'scripts/migrate-convex.ts', '--export', exportDir, '--data', dataDir, '--prints', printsDir],
      { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'test' } },
    )
    await fs.promises.writeFile(
      path.join(exportDir, 'jobs', 'documents.jsonl'),
      `${JSON.stringify({
        _id: 'job',
        _creationTime: 1_700_000_000_000,
        name: 'Unexpected probe',
        fileName: 'unexpected.stl',
        filePath: 'todo/unexpected.stl',
        quantity: 1,
        requesterEmail: 'owner@example.com',
        counts: { todo: 1, in_progress: 0, done: 0 },
      })}\n`,
    )

    await expect(
      execute(
        process.execPath,
        ['--import', 'tsx', 'scripts/verify-convex-import.ts', '--export', exportDir, '--data', dataDir, '--prints', printsDir],
        { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'test' } },
      ),
    ).rejects.toMatchObject({ stdout: expect.stringContaining('ISSUES') })
  })
})
