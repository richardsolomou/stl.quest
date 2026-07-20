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
    const { DrizzleRepository } = await import('../db/repository')
    const seed = DrizzleRepository.open(path.join(process.env.DATA_DIR, 'printhub.sqlite'))
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

  it('boots with Dropbox storage disconnected so an admin can recover it', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-app-dropbox-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const { DrizzleRepository } = await import('../db/repository')
    const seed = DrizzleRepository.open(path.join(process.env.DATA_DIR, 'printhub.sqlite'))
    seed.setSetting('storage', { adapter: 'dropbox', root: 'PrintHub' })
    seed.close()

    const { app } = await import('./app')
    const instance = await app()
    await expect(instance.defaultWorkspaceRuntime()).resolves.toMatchObject({
      storageReady: false,
      storage: { adapter: 'dropbox', root: 'PrintHub' },
    })
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

  it('reconciles workflow changes in a cached app instance', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-app-workflow-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const { DrizzleRepository } = await import('../db/repository')
    const reconcileWorkflow = vi.spyOn(DrizzleRepository.prototype, 'reconcileWorkflow')
    const { app } = await import('./app')
    await app()
    const singleton = globalThis as typeof globalThis & { __printhubWorkflowVersion?: string }
    singleton.__printhubWorkflowVersion = 'older-workflow'

    await app()

    expect(reconcileWorkflow).toHaveBeenCalledOnce()
  })

  it('requires a canonical auth URL in hosted mode', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-app-hosted-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    vi.stubEnv('PRINTHUB_HOSTED', 'true')
    vi.stubEnv('BETTER_AUTH_URL', '')
    const { app } = await import('./app')

    await expect(app()).rejects.toThrow('BETTER_AUTH_URL is required when PRINTHUB_HOSTED=true')
  })

  it('uses a configured auth URL outside hosted mode', async () => {
    vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000/')
    const { resolveAuthUrl } = await import('./app')

    expect(resolveAuthUrl()).toBe('http://localhost:3000')
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

  it('gives every non-legacy workspace a private storage namespace', async () => {
    const { workspaceStorageConfig } = await import('./app')

    expect(workspaceStorageConfig({ adapter: 'local', root: '/shared' }, 'workspace-a')).toEqual({
      adapter: 'local',
      root: path.join('/shared', 'workspace-a'),
    })
    expect(workspaceStorageConfig({ adapter: 'local', root: '/shared' }, 'workspace-b')).toEqual({
      adapter: 'local',
      root: path.join('/shared', 'workspace-b'),
    })
    expect(
      workspaceStorageConfig(
        {
          adapter: 's3',
          endpoint: 'https://s3.example.com',
          region: 'us-east-1',
          bucket: 'prints',
          prefix: 'shared',
          accessKeyId: 'key',
          secretAccessKey: 'secret',
          forcePathStyle: false,
        },
        'workspace-a',
      ),
    ).toMatchObject({ prefix: 'shared/workspace-a' })
    expect(workspaceStorageConfig({ adapter: 'local', root: '/legacy' }, 'legacy-workspace')).toEqual({
      adapter: 'local',
      root: '/legacy',
    })
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
    const { DrizzleRepository } = await import('../db/repository')
    const repository = DrizzleRepository.open(path.join(process.env.DATA_DIR, 'printhub.sqlite'))
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

  it('resolves the default storage folder to an absolute path', async () => {
    vi.stubEnv('PRINTS_DIR', './local/prints')
    const { resolveStorageConfig } = await import('./app')
    const repository = { getSetting: () => undefined }

    expect(resolveStorageConfig(repository as never)).toEqual({ adapter: 'local', root: path.resolve('./local/prints') })
  })

  it('inherits storage when creating a workspace', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-app-workspace-storage-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const prints = path.join(temporary, 'prints')
    const { DrizzleRepository } = await import('../db/repository')
    const seed = DrizzleRepository.open(path.join(process.env.DATA_DIR, 'printhub.sqlite'))
    seed.setSetting('storage', { adapter: 'local', root: prints })
    seed.close()

    const { app } = await import('./app')
    const instance = await app()
    const signup = await instance.auth.api.signUpEmail({
      body: { email: 'owner@example.com', password: 'password1234', name: 'Owner' },
      returnHeaders: true,
    })
    const headers = new Headers({
      cookie: signup.headers
        .getSetCookie()
        .map((cookie) => cookie.split(';')[0])
        .join('; '),
    })
    const workspace = await instance.createWorkspace(headers, 'Second farm')
    await instance.setActiveWorkspace(workspace.id, headers)
    const runtime = await instance.workspace(headers)

    expect(runtime.storage).toEqual({ adapter: 'local', root: prints })
    expect(runtime.storageReady).toBe(true)
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
    const explicitPrimary = await instance.workspace(ownerHeaders, primary.workspace.slug)
    const primaryRequest = primary.repository.createRequest({
      name: 'Primary model',
      fileName: 'primary.stl',
      filePath: 'todo/primary.stl',
      quantity: 1,
      ownerUserId: primary.identity.id,
    })

    expect(sameSecondary.service).toBe(secondary.service)
    expect(explicitPrimary.service).toBe(primary.service)
    expect(explicitPrimary.workspace.id).toBe(primary.workspace.id)
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
    await expect(instance.workspace(outsiderHeaders, secondaryWorkspace.slug)).rejects.toMatchObject({ status: 404 })
  })

  it('deletes an owned workspace, its records, and local files before activating the remaining workspace', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-app-delete-workspace-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    process.env.PRINTS_DIR = path.join(temporary, 'prints')
    const { app } = await import('./app')
    const instance = await app()
    const signup = await instance.auth.api.signUpEmail({
      body: { email: 'owner@example.com', password: 'password1234', name: 'Owner' },
      returnHeaders: true,
    })
    const headers = new Headers({
      cookie: signup.headers
        .getSetCookie()
        .map((cookie) => cookie.split(';')[0])
        .join('; '),
    })
    const primary = await instance.workspace(headers)
    const secondary = await instance.createWorkspace(headers, 'Second farm')
    await instance.setActiveWorkspace(primary.workspace.id, headers)
    const requestId = primary.repository.createRequest({
      name: 'Delete me',
      fileName: 'delete-me.stl',
      filePath: 'todo/delete-me.stl',
      quantity: 1,
      ownerUserId: primary.identity.id,
    })
    await primary.assets.write('todo/delete-me.stl', new Uint8Array([1, 2, 3]))
    const primaryStorage = path.join(process.env.PRINTS_DIR, primary.workspace.id)

    await expect(instance.deleteWorkspace(headers, primary.workspace.slug, primary.workspace.name)).resolves.toMatchObject({
      id: secondary.id,
    })
    expect(instance.repository.workspaceById(primary.workspace.id)).toBeUndefined()
    expect(instance.repository.scoped(primary.workspace.id).getRequest(requestId)).toBeUndefined()
    await expect(fs.promises.stat(primaryStorage)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(instance.workspace(headers)).resolves.toMatchObject({ workspace: { id: secondary.id } })
    expect(instance.repository.listWorkspacesForUser(primary.identity.id)).toEqual([expect.objectContaining({ id: secondary.id })])
  })

  it('rejects a mismatched workspace name and protects the only workspace', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-app-delete-last-workspace-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    process.env.PRINTS_DIR = path.join(temporary, 'prints')
    const { app } = await import('./app')
    const instance = await app()
    const signup = await instance.auth.api.signUpEmail({
      body: { email: 'owner@example.com', password: 'password1234', name: 'Owner' },
      returnHeaders: true,
    })
    const headers = new Headers({
      cookie: signup.headers
        .getSetCookie()
        .map((cookie) => cookie.split(';')[0])
        .join('; '),
    })
    const workspace = await instance.workspace(headers)

    await expect(instance.deleteWorkspace(headers, workspace.workspace.slug, 'Wrong name')).rejects.toMatchObject({ status: 400 })
    await expect(instance.deleteWorkspace(headers, workspace.workspace.slug, workspace.workspace.name)).rejects.toMatchObject({
      status: 409,
    })
  })
})
