import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { member, organization, user } from '../db/schema'

describe('app initialization', () => {
  let temporary: string | undefined

  afterEach(async () => {
    delete process.env.DATA_DIR
    delete process.env.PRINTS_DIR
    vi.unstubAllEnvs()
    const singleton = globalThis as typeof globalThis & { __stlquest?: Promise<{ close(): Promise<void> }> }
    const running = singleton.__stlquest
    delete singleton.__stlquest
    if (running) await (await running.catch(() => undefined))?.close()
    vi.resetModules()
    if (temporary) await fs.promises.rm(temporary, { recursive: true, force: true })
  })

  it('boots with unwritable storage and recovers once settings point somewhere writable', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const invalidPrints = path.join(temporary, 'not-a-directory')
    await fs.promises.writeFile(invalidPrints, 'blocked')
    const { DrizzleRepository } = await import('../db/repository')
    const seed = DrizzleRepository.open(path.join(process.env.DATA_DIR, 'stlquest.sqlite'))
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
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-dropbox-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const { DrizzleRepository } = await import('../db/repository')
    const seed = DrizzleRepository.open(path.join(process.env.DATA_DIR, 'stlquest.sqlite'))
    seed.setSetting('storage', { adapter: 'dropbox', root: 'STL Quest' })
    seed.close()

    const { app } = await import('./app')
    const instance = await app()
    await expect(instance.defaultWorkspaceRuntime()).resolves.toMatchObject({
      storageReady: false,
      storage: { adapter: 'dropbox', root: 'STL Quest' },
    })
  })

  it('clears a rejected singleton and recovers after a transient database failure', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-db-'))
    const blocked = path.join(temporary, 'blocked')
    await fs.promises.writeFile(blocked, 'not a directory')
    process.env.DATA_DIR = path.join(blocked, 'data')
    const { app } = await import('./app')
    await expect(app()).rejects.toThrow()
    process.env.DATA_DIR = path.join(temporary, 'data')
    await expect(app()).resolves.toMatchObject({ repository: expect.anything(), defaultWorkspaceRuntime: expect.any(Function) })
  })

  it('reconciles workflow changes in a cached app instance', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-workflow-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const { DrizzleRepository } = await import('../db/repository')
    const reconcileWorkflow = vi.spyOn(DrizzleRepository.prototype, 'reconcileWorkflow')
    const { app } = await import('./app')
    await app()
    const singleton = globalThis as typeof globalThis & { __stlquestWorkflowVersion?: string }
    singleton.__stlquestWorkflowVersion = 'older-workflow'

    await app()

    expect(reconcileWorkflow).toHaveBeenCalledOnce()
  })

  it('shuts down telemetry when the application closes', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-telemetry-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const { OptionalPostHogTelemetry } = await import('../adapters/telemetry')
    const shutdown = vi.spyOn(OptionalPostHogTelemetry.prototype, 'shutdown')
    const { app } = await import('./app')
    const instance = await app()

    await instance.close()

    expect(shutdown).toHaveBeenCalledOnce()
  })

  it('starts in hosted mode without a configured auth URL', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-hosted-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    vi.stubEnv('STLQUEST_HOSTED', 'true')
    vi.stubEnv('BETTER_AUTH_URL', '')
    const { app } = await import('./app')
    const starting = app()

    await expect(starting).resolves.toBeDefined()
    await (await starting).close()
  })

  it('uses a configured auth URL outside hosted mode', async () => {
    vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000/')
    const { resolveAuthUrl } = await import('./app')

    expect(resolveAuthUrl()).toBe('http://localhost:3000')
  })

  it('does not initialize workspace storage until the workspace is accessed', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-lazy-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    process.env.PRINTS_DIR = path.join(temporary, 'prints')
    const workspacePrints = path.join(process.env.PRINTS_DIR, 'test-workspace')
    const { app } = await import('./app')
    const instance = await app()

    await expect(fs.promises.stat(workspacePrints)).rejects.toMatchObject({ code: 'ENOENT' })
    await instance.defaultWorkspaceRuntime()
    await expect(fs.promises.stat(workspacePrints)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
  })

  it('gives every new workspace a private storage namespace and preserves legacy storage paths', async () => {
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
    expect(
      workspaceStorageConfig(
        { adapter: 'webdav', endpoint: 'https://storage.example.com/dav', root: 'shared', username: 'user', password: 'secret' },
        'workspace-a',
      ),
    ).toMatchObject({ root: 'shared/workspace-a' })
    expect(workspaceStorageConfig({ adapter: 'local', root: '/legacy' }, 'legacy-workspace')).toEqual({
      adapter: 'local',
      root: '/legacy',
    })
    expect(workspaceStorageConfig({ adapter: 'local', root: '/legacy' }, 'legacy-workspace', true)).toEqual({
      adapter: 'local',
      root: path.join('/legacy', 'legacy-workspace'),
    })
  })

  it('migrates legacy workspace assets into a private storage namespace on startup', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-legacy-storage-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    process.env.PRINTS_DIR = path.join(temporary, 'prints')
    const sourcePath = path.join(process.env.PRINTS_DIR, 'todo', 'model.stl')
    await fs.promises.mkdir(path.dirname(sourcePath), { recursive: true })
    await fs.promises.writeFile(sourcePath, 'model')
    const { DrizzleRepository } = await import('../db/repository')
    const seed = DrizzleRepository.open(path.join(process.env.DATA_DIR, 'stlquest.sqlite'))
    const now = new Date()
    seed.database
      .insert(user)
      .values({ id: 'owner', name: 'Owner', email: 'owner@example.com', emailVerified: true, createdAt: now, updatedAt: now })
      .run()
    seed.database.insert(organization).values({ id: 'legacy-workspace', name: 'STL Quest', slug: 'stl-quest', createdAt: now }).run()
    seed.database
      .insert(member)
      .values({ id: 'legacy-owner', organizationId: 'legacy-workspace', userId: 'owner', role: 'owner', createdAt: now })
      .run()
    seed.scoped('legacy-workspace').createRequest({
      name: 'Model',
      fileName: 'model.stl',
      filePath: 'todo/model.stl',
      quantity: 1,
      ownerUserId: 'owner',
    })
    seed.close()

    const { app } = await import('./app')
    const instance = await app()
    const runtime = await instance.defaultWorkspaceRuntime()
    await runtime.storageMigration.waitForIdle()
    const destinationPath = path.join(process.env.PRINTS_DIR, 'legacy-workspace', 'todo', 'model.stl')
    const migrated = await app()
    const repository = migrated.repository.scoped('legacy-workspace')

    expect(repository.getSetting('legacy-storage-namespace')).toBe(true)
    await expect(fs.promises.readFile(destinationPath, 'utf8')).resolves.toBe('model')
    await expect(fs.promises.readFile(sourcePath, 'utf8')).resolves.toBe('model')
    expect(repository.getSetting('storage')).toEqual({
      adapter: 'local',
      root: process.env.PRINTS_DIR,
    })
  })

  it('preserves stale-looking parts with live durable sessions and removes expired ones', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-uploads-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const uploads = path.join(process.env.DATA_DIR, 'uploads')
    await fs.promises.mkdir(uploads, { recursive: true })
    const live = path.join(uploads, 'live-upload-id.part')
    const expired = path.join(uploads, 'expired-upload-id.part')
    await Promise.all([fs.promises.writeFile(live, 'live'), fs.promises.writeFile(expired, 'expired')])
    const old = new Date(Date.now() - 2 * 86_400_000)
    await Promise.all([fs.promises.utimes(live, old, old), fs.promises.utimes(expired, old, old)])
    const { DrizzleRepository } = await import('../db/repository')
    const repository = DrizzleRepository.open(path.join(process.env.DATA_DIR, 'stlquest.sqlite'))
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
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-workspace-storage-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const prints = path.join(temporary, 'prints')
    const { DrizzleRepository } = await import('../db/repository')
    const seed = DrizzleRepository.open(path.join(process.env.DATA_DIR, 'stlquest.sqlite'))
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
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-workspaces-'))
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
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-delete-workspace-'))
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
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-delete-last-workspace-'))
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
