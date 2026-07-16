import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { user } from '../db/schema'

describe('app initialization', () => {
  let temporary: string | undefined

  afterEach(async () => {
    delete process.env.DATA_DIR
    delete process.env.PRINTS_DIR
    vi.unstubAllEnvs()
    const singleton = globalThis as typeof globalThis & { __printhub?: Promise<{ close(): Promise<void> }> }
    const running = singleton.__printhub
    delete singleton.__printhub
    if (running) await (await running.catch(() => undefined))?.close()
    vi.resetModules()
    if (temporary) await fs.promises.rm(temporary, { recursive: true, force: true })
  })

  it('boots with unwritable storage and recovers once settings point somewhere writable', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-app-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const invalidPrints = path.join(temporary, 'not-a-directory')
    await fs.promises.writeFile(invalidPrints, 'blocked')
    const { SqliteRepository } = await import('../adapters/sqlite')
    const seed = SqliteRepository.open(path.join(process.env.DATA_DIR, 'printhub.sqlite'))
    seed.setSetting('storage', { adapter: 'local', root: invalidPrints })
    seed.close()

    const { app } = await import('./app')
    const broken = await app()
    const runtime = await broken.defaultWorkspaceRuntime()
    expect(runtime.storageReady).toBe(false)
    await fs.promises.rm(invalidPrints)
    await fs.promises.mkdir(invalidPrints)
    await expect(runtime.recoverStorage()).resolves.toBe(true)
    expect(runtime.storageReady).toBe(true)
  })

  it('clears a rejected singleton and recovers after a transient database failure', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-app-db-'))
    const blocked = path.join(temporary, 'blocked')
    await fs.promises.writeFile(blocked, 'not a directory')
    process.env.DATA_DIR = path.join(blocked, 'data')
    const { app } = await import('./app')
    await expect(app()).rejects.toThrow()
    process.env.DATA_DIR = path.join(temporary, 'data')
    await expect(app()).resolves.toMatchObject({ repository: expect.anything(), defaultWorkspaceRuntime: expect.any(Function) })
  })

  it('requires a canonical auth URL in hosted mode', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-app-hosted-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    vi.stubEnv('PRINTHUB_HOSTED', 'true')
    vi.stubEnv('BETTER_AUTH_URL', '')
    const { app } = await import('./app')

    await expect(app()).rejects.toThrow('BETTER_AUTH_URL is required when PRINTHUB_HOSTED=true')
  })

  it('does not initialize workspace storage until the workspace is accessed', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-app-lazy-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    process.env.PRINTS_DIR = path.join(temporary, 'prints')
    const workspacePrints = path.join(process.env.PRINTS_DIR, 'test-workspace')
    const { app } = await import('./app')
    const instance = await app()

    await expect(fs.promises.stat(workspacePrints)).rejects.toMatchObject({ code: 'ENOENT' })
    await instance.defaultWorkspaceRuntime()
    await expect(fs.promises.stat(workspacePrints)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
  })

  it('preserves stale-looking parts with live durable sessions and removes expired ones', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-app-uploads-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const uploads = path.join(process.env.DATA_DIR, 'uploads')
    await fs.promises.mkdir(uploads, { recursive: true })
    const live = path.join(uploads, 'live-upload-id.part')
    const expired = path.join(uploads, 'expired-upload-id.part')
    await Promise.all([fs.promises.writeFile(live, 'live'), fs.promises.writeFile(expired, 'expired')])
    const old = new Date(Date.now() - 2 * 86_400_000)
    await Promise.all([fs.promises.utimes(live, old, old), fs.promises.utimes(expired, old, old)])
    const { SqliteRepository } = await import('../adapters/sqlite')
    const repository = SqliteRepository.open(path.join(process.env.DATA_DIR, 'printhub.sqlite'))
    repository.database
      .insert(user)
      .values({
        id: 'owner',
        name: 'Owner',
        email: 'owner@example.com',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        role: 'requester',
      })
      .run()
    repository.setSetting('storage', { adapter: 'local', root: path.join(temporary, 'prints') })
    const liveExpiry = Date.now() + 60_000
    repository.createUploadSession('live-upload-id', 'owner', liveExpiry, 3)
    repository.reserveUpload('live-upload-id', 'owner', 4, liveExpiry, { count: 3, bytes: 100 })
    const expiredExpiry = Date.now() - 1
    repository.createUploadSession('expired-upload-id', 'owner', expiredExpiry, 3)
    repository.reserveUpload('expired-upload-id', 'owner', 7, expiredExpiry, { count: 3, bytes: 100 })
    repository.close()
    const { app } = await import('./app')
    await app()
    expect(await fs.promises.readFile(live, 'utf8')).toBe('live')
    await expect(fs.promises.stat(expired)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('enables telemetry until an admin opts out', async () => {
    const { resolveTelemetryConfig } = await import('./app')
    const repository = { getSetting: () => undefined }
    expect(resolveTelemetryConfig(repository as never)).toEqual({ enabled: true })
  })

  it('creates one runtime per workspace and rejects non-members', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-app-workspaces-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    process.env.PRINTS_DIR = path.join(temporary, 'prints')
    const { app } = await import('./app')
    const instance = await app()
    const ownerSignup = await instance.auth.api.signUpEmail({
      body: { email: 'owner@example.com', password: 'password1234', name: 'Owner' },
      returnHeaders: true,
    })
    const ownerHeaders = new Headers({
      cookie: ownerSignup.headers
        .getSetCookie()
        .map((cookie) => cookie.split(';')[0])
        .join('; '),
    })
    const primary = await instance.workspace(ownerHeaders)
    const secondaryWorkspace = instance.repository.createWorkspace(primary.identity, 'Second farm')
    await instance.setActiveWorkspace(secondaryWorkspace.id, ownerHeaders)
    const [secondary, sameSecondary] = await Promise.all([instance.workspace(ownerHeaders), instance.workspace(ownerHeaders)])
    const primaryRequest = primary.repository.createRequest({
      name: 'Primary model',
      fileName: 'primary.stl',
      filePath: 'todo/primary.stl',
      quantity: 1,
      ownerUserId: primary.identity.id,
    })

    expect(sameSecondary.service).toBe(secondary.service)
    expect(secondary.repository.getRequest(primaryRequest)).toBeUndefined()

    const outsiderSignup = await instance.auth.api.signUpEmail({
      body: { email: 'outsider@example.com', password: 'password1234', name: 'Outsider' },
      returnHeaders: true,
    })
    const outsiderHeaders = new Headers({
      cookie: outsiderSignup.headers
        .getSetCookie()
        .map((cookie) => cookie.split(';')[0])
        .join('; '),
    })
    await expect(instance.setActiveWorkspace(secondaryWorkspace.id, outsiderHeaders)).rejects.toMatchObject({ status: 404 })
  })
})
