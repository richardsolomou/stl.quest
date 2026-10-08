import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAssetKey } from '../core/assetKeys'
import { member, organization, subscription, user } from '../db/schema'
import type { WorkLocker } from './workLock'

async function signUp(instance: Awaited<ReturnType<typeof import('./app').app>>, email: string, name: string) {
  const signup = await instance.auth.api.signUpEmail({ body: { email, password: 'password1234', name }, returnHeaders: true })
  return new Headers({
    cookie: signup.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; '),
  })
}

describe('app initialization', () => {
  let temporary: string | undefined

  afterEach(async () => {
    vi.restoreAllMocks()
    delete process.env.DATA_DIR
    delete process.env.PRINTS_DIR
    vi.unstubAllEnvs()
    await (await import('./app')).resetApp()
    vi.resetModules()
    if (temporary) await fs.promises.rm(temporary, { recursive: true, force: true })
  })

  it('closes the shared publisher once after workspace runtimes stop', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-publisher-shutdown-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    process.env.PRINTS_DIR = path.join(temporary, 'prints')
    const { RealtimePublisher } = await import('../adapters/events')
    const closed = vi.spyOn(RealtimePublisher.prototype, 'close')
    try {
      const { app } = await import('./app')
      const instance = await app()
      await instance.defaultWorkspaceRuntime()
      await instance.close()
      expect(closed).toHaveBeenCalledOnce()
      expect(closed).toHaveBeenCalledWith(expect.any(AbortSignal))
    } finally {
      closed.mockRestore()
    }
  })

  it('records local mode so a later distributed cutover drains local uploads again', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-local-mode-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    process.env.PRINTS_DIR = path.join(temporary, 'prints')
    const { DrizzleRepository } = await import('../db/repository')
    const seed = await DrizzleRepository.open(path.join(process.env.DATA_DIR, 'stlquest.sqlite'))
    await seed.setDeploymentSetting('distributed-runtime-mode', 'distributed')
    await seed.close()

    const { app } = await import('./app')
    const instance = await app()

    expect(await instance.repository.getDeploymentSetting('distributed-runtime-mode')).toBe('local')
  })

  it('boots with unwritable storage and recovers once settings point somewhere writable', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const invalidPrints = path.join(temporary, 'not-a-directory')
    await fs.promises.writeFile(invalidPrints, 'blocked')
    const { DrizzleRepository } = await import('../db/repository')
    const seed = await DrizzleRepository.open(path.join(process.env.DATA_DIR, 'stlquest.sqlite'))
    await seed.setSetting('storage', { adapter: 'local', root: invalidPrints })
    await seed.close()

    const { app } = await import('./app')
    const broken = await app()
    const runtime = await broken.defaultWorkspaceRuntime()
    expect(runtime.storageReady).toBe(false)
    expect(runtime.storageError).toContain('not-a-directory')
    await fs.promises.rm(invalidPrints)
    await fs.promises.mkdir(invalidPrints)
    await expect(runtime.recoverStorage()).resolves.toBe(true)
    expect(runtime.storageReady).toBe(true)
    expect(runtime.storageError).toBeUndefined()
  })

  it('boots a workspace runtime when the recovery lease cannot be acquired and retries once it can', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-recovery-lease-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    process.env.PRINTS_DIR = path.join(temporary, 'prints')
    const { DrizzleRepository } = await import('../db/repository')
    const repository = await DrizzleRepository.open(path.join(process.env.DATA_DIR, 'stlquest.sqlite'))
    await repository.database.insert(organization).values({ id: 'farm', name: 'Farm', slug: 'farm', createdAt: new Date() }).run()
    const workspace = (await repository.listWorkspaces())[0]

    const { UploadStaging } = await import('../adapters/staging')
    const { TusUploadStore } = await import('../adapters/tus')
    const { OptionalPostHogTelemetry } = await import('../adapters/telemetry')
    const staging = new UploadStaging(process.env.DATA_DIR)
    await staging.initialize()

    // Simulates a contended recovery lease that times out on acquisition until it frees up.
    let acquirable = false
    const workLocker: WorkLocker = {
      newLock: (id) => ({
        lock: async () => {
          if (id.startsWith('recovery:') && !acquirable) throw new Error(`Acquire mutex ${id} timeout`)
        },
        unlock: async () => undefined,
      }),
    }

    const { createWorkspaceRuntime } = await import('./app')
    const runtime = await createWorkspaceRuntime({
      rootRepository: repository,
      workspace,
      staging,
      tusUploads: new TusUploadStore(process.env.DATA_DIR),
      telemetry: new OptionalPostHogTelemetry(() => false),
      invalidate: async () => undefined,
      workLocker,
    })

    // A rejected acquisition must degrade gracefully, not blow up the whole runtime boot.
    expect(runtime.storageReady).toBe(false)

    // ...and clearing the memo lets the next call retry rather than replay a rejected promise.
    acquirable = true
    await expect(runtime.recoverStorage()).resolves.toBe(true)
    expect(runtime.storageReady).toBe(true)

    await runtime.close()
    await repository.close()
  })

  it('keeps writable storage ready when trash cleanup fails', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-trash-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    process.env.PRINTS_DIR = path.join(temporary, 'prints')
    const { LocalAssetStore } = await import('../adapters/filesystem')
    vi.spyOn(LocalAssetStore.prototype, 'sweepTrash').mockRejectedValueOnce(new Error('cleanup unavailable'))
    const { app } = await import('./app')

    const runtime = await (await app()).defaultWorkspaceRuntime()

    expect(runtime.storageReady).toBe(true)
  })

  it('loads a workspace with initialized but unwritable storage as not ready', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-unwritable-probe-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    process.env.PRINTS_DIR = path.join(temporary, 'prints')
    const { LocalAssetStore } = await import('../adapters/filesystem')
    vi.spyOn(LocalAssetStore.prototype, 'writable').mockRejectedValueOnce(new Error('storage is read-only'))
    const { app } = await import('./app')
    const instance = await app()

    await expect(instance.defaultWorkspaceRuntime()).resolves.toMatchObject({ storageReady: false })
    await expect(instance.defaultWorkspaceRuntime()).resolves.toMatchObject({ storageError: 'storage is read-only' })
  })

  it('boots with Dropbox storage disconnected so an admin can recover it', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-dropbox-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const { DrizzleRepository } = await import('../db/repository')
    const seed = await DrizzleRepository.open(path.join(process.env.DATA_DIR, 'stlquest.sqlite'))
    await seed.setSetting('storage', { adapter: 'dropbox', root: 'STL Quest' })
    await seed.close()

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
    const { peekGlobalSingleton } = await import('ras-stack/server')
    const lifecycle = peekGlobalSingleton('stlquest.lifecycle') as { workflowVersion?: string }
    lifecycle.workflowVersion = 'older-workflow'

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

  it('reloads only the workspace whose storage migration completes', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-migration-invalidation-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    process.env.PRINTS_DIR = path.join(temporary, 'prints')
    const { DrizzleRepository } = await import('../db/repository')
    const seed = await DrizzleRepository.open(path.join(process.env.DATA_DIR, 'stlquest.sqlite'))
    await seed.database
      .insert(organization)
      .values([
        { id: 'workspace-a', name: 'Workspace A', slug: 'workspace-a', createdAt: new Date() },
        { id: 'workspace-b', name: 'Workspace B', slug: 'workspace-b', createdAt: new Date() },
      ])
      .run()
    await seed.close()
    const { app } = await import('./app')
    const instance = await app()
    const first = await instance.publicWorkspace('workspace-a')
    const unaffected = await instance.publicWorkspace('workspace-b')

    await first.storageMigration.start({ adapter: 'local', root: path.join(temporary, 'migrated') })
    await first.storageMigration.waitForIdle()

    expect(await app()).toBe(instance)
    expect(await instance.publicWorkspace('workspace-a')).not.toBe(first)
    expect(await instance.publicWorkspace('workspace-b')).toBe(unaffected)
  })

  it('gives every new workspace a private storage namespace and preserves legacy storage paths', async () => {
    const { canonicalCloudStorageConfig, workspaceStorageConfig } = await import('./app')

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
    expect(workspaceStorageConfig({ adapter: 'google-drive', root: '', layout: 'workspace-root-v1' }, 'workspace-a')).toEqual({
      adapter: 'google-drive',
      root: 'stlquest-workspace-a',
      layout: 'workspace-root-v1',
    })
    expect(workspaceStorageConfig({ adapter: 'google-drive', root: '' }, 'workspace-a')).toEqual({
      adapter: 'google-drive',
      root: 'workspace-a',
    })
    expect(workspaceStorageConfig({ adapter: 'google-drive', root: 'legacy' }, 'workspace-a')).toEqual({
      adapter: 'google-drive',
      root: 'legacy/workspace-a',
    })
    expect(canonicalCloudStorageConfig({ adapter: 'google-drive', root: 'legacy' })).toEqual({
      adapter: 'google-drive',
      root: '',
      layout: 'workspace-root-v1',
    })
    expect(canonicalCloudStorageConfig({ adapter: 'google-drive', root: '', layout: 'workspace-root-v1' })).toBeUndefined()
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
    const seed = await DrizzleRepository.open(path.join(process.env.DATA_DIR, 'stlquest.sqlite'))
    const now = new Date()
    await seed.database
      .insert(user)
      .values({ id: 'owner', name: 'Owner', email: 'owner@example.com', emailVerified: true, createdAt: now, updatedAt: now })
      .run()
    await seed.database.insert(organization).values({ id: 'legacy-workspace', name: 'STL Quest', slug: 'stl-quest', createdAt: now }).run()
    await seed.database
      .insert(member)
      .values({ id: 'legacy-owner', organizationId: 'legacy-workspace', userId: 'owner', role: 'owner', createdAt: now })
      .run()
    const requestId = await (
      await seed.scoped('legacy-workspace')
    ).createRequest({
      name: 'Model',
      fileName: 'model.stl',
      filePath: 'todo/model.stl',
      quantity: 1,
      ownerUserId: 'owner',
    })
    await seed.close()

    const { app, resolveStorageConfig } = await import('./app')
    const instance = await app()
    const runtime = await instance.defaultWorkspaceRuntime()
    await runtime.storageMigration.waitForIdle()
    const stablePath = createAssetKey(requestId, 'model.stl')
    const destinationPath = path.join(process.env.PRINTS_DIR, 'legacy-workspace', stablePath)
    const migrated = await app()
    const repository = await migrated.repository.scoped('legacy-workspace')

    expect(await repository.getSetting('legacy-storage-namespace')).toBe(true)
    await expect(fs.promises.readFile(destinationPath, 'utf8')).resolves.toBe('model')
    await expect(fs.promises.stat(sourcePath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await repository.getRequest(requestId))?.filePath).toBe(stablePath)
    expect(await resolveStorageConfig(repository)).toEqual({
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
    const repository = await DrizzleRepository.open(path.join(process.env.DATA_DIR, 'stlquest.sqlite'))
    await repository.database
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
    await repository.setSetting('storage', { adapter: 'local', root: path.join(temporary, 'prints') })
    const liveExpiry = Date.now() + 60_000
    await repository.createUploadSession('live-upload-id', 'owner', liveExpiry, 3)
    await repository.reserveUpload('live-upload-id', 'owner', 4, liveExpiry, { count: 3, bytes: 100 })
    const expiredExpiry = Date.now() - 1
    await repository.createUploadSession('expired-upload-id', 'owner', expiredExpiry, 3)
    await repository.reserveUpload('expired-upload-id', 'owner', 7, expiredExpiry, { count: 3, bytes: 100 })
    await repository.close()
    const { app } = await import('./app')
    await app()
    expect(await fs.promises.readFile(live, 'utf8')).toBe('live')
    await expect(fs.promises.stat(expired)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('enables telemetry until an admin opts out', async () => {
    const { resolveTelemetryConfig } = await import('./app')
    const repository = { getSetting: () => undefined }
    expect(await resolveTelemetryConfig(repository as never)).toEqual({ enabled: true })
  })

  it('allows self-signup until a super admin turns it off', async () => {
    const { resolveSelfSignupConfig } = await import('./app')
    expect(await resolveSelfSignupConfig({ getSetting: async () => undefined } as never)).toEqual({ enabled: true })
    expect(await resolveSelfSignupConfig({ getSetting: async () => ({ enabled: false }) } as never)).toEqual({ enabled: false })
  })

  it('resolves the default storage folder to an absolute path', async () => {
    vi.stubEnv('PRINTS_DIR', './local/prints')
    const { resolveStorageConfig } = await import('./app')
    const repository = { getSetting: () => undefined }

    expect(await resolveStorageConfig(repository as never)).toEqual({ adapter: 'local', root: path.resolve('./local/prints') })
  })

  it('does not move an existing unconfigured workspace to managed storage when deployment credentials are added', async () => {
    vi.stubEnv('STLQUEST_HOSTED', 'true')
    vi.stubEnv('STLQUEST_HOSTED_STORAGE_BUCKET', 'models')
    vi.stubEnv('STLQUEST_HOSTED_STORAGE_ENDPOINT', 'https://account.r2.cloudflarestorage.com')
    vi.stubEnv('STLQUEST_HOSTED_STORAGE_ACCESS_KEY_ID', 'access')
    vi.stubEnv('STLQUEST_HOSTED_STORAGE_SECRET_ACCESS_KEY', 'secret')
    vi.stubEnv('PRINTS_DIR', '/existing/prints')
    const { resolveStorageConfig } = await import('./app')

    expect(await resolveStorageConfig({ getSetting: async () => undefined } as never)).toEqual({
      adapter: 'local',
      root: '/existing/prints',
    })
  })

  it('uses PRINTS_DIR_OVERRIDE instead of an encrypted local storage path', async () => {
    vi.stubEnv('PRINTS_DIR_OVERRIDE', './restored/prints')
    vi.stubEnv('INTEGRATIONS_ENCRYPTION_KEY', Buffer.alloc(32).toString('base64url'))
    const { encryptSetting } = await import('./integrations')
    const encrypted = encryptSetting({ adapter: 'local', root: '/original/prints' })
    const repository = { getSetting: (key: string) => (key === 'storageEncrypted' ? encrypted : undefined) }
    const { resolveStorageConfig } = await import('./app')

    expect(await resolveStorageConfig(repository as never)).toEqual({ adapter: 'local', root: path.resolve('./restored/prints') })
  })

  it('keeps encrypted remote storage when PRINTS_DIR_OVERRIDE is set', async () => {
    vi.stubEnv('PRINTS_DIR_OVERRIDE', './restored/prints')
    vi.stubEnv('INTEGRATIONS_ENCRYPTION_KEY', Buffer.alloc(32).toString('base64url'))
    const { encryptSetting } = await import('./integrations')
    const storage = { adapter: 'webdav', endpoint: 'https://storage.example.com', root: 'models', username: 'user', password: 'secret' }
    const encrypted = encryptSetting(storage)
    const repository = { getSetting: (key: string) => (key === 'storageEncrypted' ? encrypted : undefined) }
    const { resolveStorageConfig } = await import('./app')

    expect(await resolveStorageConfig(repository as never)).toEqual(storage)
  })

  it('starts a new workspace without inheriting storage', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-workspace-storage-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const prints = path.join(temporary, 'prints')
    process.env.PRINTS_DIR = path.join(temporary, 'default-prints')
    const { DrizzleRepository } = await import('../db/repository')
    const seed = await DrizzleRepository.open(path.join(process.env.DATA_DIR, 'stlquest.sqlite'))
    await seed.setSetting('storage', { adapter: 'local', root: prints })
    await seed.close()

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

    expect(await runtime.repository.getSetting('storageEncrypted')).toBeUndefined()
    expect(runtime.storage).toEqual({ adapter: 'local', root: process.env.PRINTS_DIR })
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
    const secondaryWorkspace = await instance.repository.createWorkspace(primary.identity, 'Second farm')
    await instance.setActiveWorkspace(secondaryWorkspace.id, ownerHeaders)
    const [secondary, sameSecondary] = await Promise.all([instance.workspace(ownerHeaders), instance.workspace(ownerHeaders)])
    const explicitPrimary = await instance.workspace(ownerHeaders, primary.workspace.slug)
    const primaryRequest = await primary.repository.createRequest({
      name: 'Primary model',
      fileName: 'primary.stl',
      filePath: 'todo/primary.stl',
      quantity: 1,
      ownerUserId: primary.identity.id,
    })

    expect(sameSecondary.service).toBe(secondary.service)
    expect(explicitPrimary.service).toBe(primary.service)
    expect(explicitPrimary.workspace.id).toBe(primary.workspace.id)
    expect(await secondary.repository.getRequest(primaryRequest)).toBeUndefined()

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

  it('keeps a workspace last-active date after the member switches to another workspace', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-member-activity-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    process.env.PRINTS_DIR = path.join(temporary, 'prints')
    const { app } = await import('./app')
    const instance = await app()
    const headers = await signUp(instance, 'owner@example.com', 'Owner')
    const primary = await instance.workspace(headers)
    const secondary = await instance.createWorkspace(headers, 'Second farm')
    await instance.setActiveWorkspace(secondary.id, headers)
    await instance.workspace(headers)

    expect(await primary.repository.listMemberActivity()).toEqual([{ userId: primary.identity.id, lastActiveAt: expect.any(Number) }])
  })

  it('records member activity in the workspace a session switches to', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-member-activity-switch-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    process.env.PRINTS_DIR = path.join(temporary, 'prints')
    const { app } = await import('./app')
    const instance = await app()
    const headers = await signUp(instance, 'owner@example.com', 'Owner')
    const secondary = await instance.createWorkspace(headers, 'Second farm')
    await instance.setActiveWorkspace(secondary.id, headers)
    const runtime = await instance.workspace(headers)

    expect(await runtime.repository.listMemberActivity()).toEqual([{ userId: runtime.identity.id, lastActiveAt: expect.any(Number) }])
  })

  it('skips the member activity write for an hour after recording it in the same process', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-member-activity-throttle-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    process.env.PRINTS_DIR = path.join(temporary, 'prints')
    const { DrizzleRepository } = await import('../db/repository')
    const recorded = vi.spyOn(DrizzleRepository.prototype, 'recordMemberActivity')
    const now = vi.spyOn(Date, 'now')
    const { app } = await import('./app')
    const instance = await app()
    const headers = await signUp(instance, 'owner@example.com', 'Owner')
    const start = Date.parse('2026-07-12T12:00:00.000Z')
    now.mockReturnValue(start)
    await instance.workspace(headers)
    now.mockReturnValue(start + 59 * 60_000)
    await instance.workspace(headers)
    now.mockReturnValue(start + 61 * 60_000)
    await instance.workspace(headers)

    expect(recorded.mock.calls.map(([, at]) => at)).toEqual([start, start + 61 * 60_000])
  })

  it('serves the workspace when recording member activity fails', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-member-activity-failure-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    process.env.PRINTS_DIR = path.join(temporary, 'prints')
    const { DrizzleRepository } = await import('../db/repository')
    vi.spyOn(DrizzleRepository.prototype, 'recordMemberActivity').mockRejectedValue(new Error('database or disk is full'))
    const { app } = await import('./app')
    const instance = await app()
    const headers = await signUp(instance, 'owner@example.com', 'Owner')

    await expect(instance.workspace(headers)).resolves.toMatchObject({ identity: { email: 'owner@example.com' } })
  })

  it('does not record member activity for impersonated sessions', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-member-activity-impersonation-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    process.env.PRINTS_DIR = path.join(temporary, 'prints')
    const { app } = await import('./app')
    const instance = await app()
    const superAdminHeaders = await signUp(instance, 'admin@example.com', 'Admin')
    const { withAuthProvisioning } = await import('./authInvite')
    const created = await withAuthProvisioning(() =>
      instance.auth.api.createUser({
        body: { email: 'maker@example.com', password: 'password1234', name: 'Maker' },
        headers: superAdminHeaders,
      }),
    )
    const impersonated = await instance.auth.api.impersonateUser({
      body: { userId: created.user.id },
      headers: superAdminHeaders,
      returnHeaders: true,
    })
    const runtime = await instance.workspace(new Headers({ cookie: sessionCookies(impersonated.headers) }))

    expect(await runtime.repository.listMemberActivity()).toEqual([])
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
    const requestId = await primary.repository.createRequest({
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
    expect(await instance.repository.workspaceById(primary.workspace.id)).toBeUndefined()
    expect(await (await instance.repository.scoped(primary.workspace.id)).getRequest(requestId)).toBeUndefined()
    await expect(fs.promises.stat(primaryStorage)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(instance.workspace(headers)).resolves.toMatchObject({ workspace: { id: secondary.id } })
    expect(await instance.repository.listWorkspacesForUser(primary.identity.id)).toEqual([expect.objectContaining({ id: secondary.id })])
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

  it('deletes a managed workspace before clearing its prefix and retries failed cleanup on startup', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-delete-managed-'))
    vi.stubEnv('DATA_DIR', path.join(temporary, 'data'))
    vi.stubEnv('PRINTS_DIR', path.join(temporary, 'prints'))
    vi.stubEnv('STLQUEST_HOSTED', 'true')
    vi.stubEnv('STLQUEST_HOSTED_STORAGE_BUCKET', 'models')
    vi.stubEnv('STLQUEST_HOSTED_STORAGE_ENDPOINT', 'https://storage.example.com')
    vi.stubEnv('STLQUEST_HOSTED_STORAGE_ACCESS_KEY_ID', 'access')
    vi.stubEnv('STLQUEST_HOSTED_STORAGE_SECRET_ACCESS_KEY', 'secret')
    const { S3AssetStore } = await import('../adapters/s3')
    vi.spyOn(S3AssetStore.prototype, 'initialize').mockResolvedValue(undefined)
    vi.spyOn(S3AssetStore.prototype, 'writable').mockResolvedValue(undefined)
    vi.spyOn(S3AssetStore.prototype, 'inventory').mockResolvedValue({ files: 0, folders: 0, bytes: 0, entries: [], truncated: false })
    vi.spyOn(S3AssetStore.prototype, 'sweepTrash').mockResolvedValue(undefined)
    const clear = vi.spyOn(S3AssetStore.prototype, 'clear').mockRejectedValueOnce(new Error('R2 unavailable')).mockResolvedValue(undefined)
    const { app, resetApp } = await import('./app')
    let instance = await app()
    const signup = await instance.auth.api.signUpEmail({
      body: { email: 'managed-owner@example.com', password: 'password1234', name: 'Owner' },
      returnHeaders: true,
    })
    const headers = new Headers({
      cookie: signup.headers
        .getSetCookie()
        .map((cookie) => cookie.split(';')[0])
        .join('; '),
    })
    const primary = await instance.workspace(headers)
    const secondary = await instance.createWorkspace(headers, 'BYO workspace')
    const { encryptSetting } = await import('./integrations')
    await primary.repository.setSettings({ storageEncrypted: encryptSetting({ adapter: 'managed' }) }, ['storage'])
    await primary.repository.claimManagedStorage(primary.identity.id, 1)
    await resetApp()
    instance = await app()

    await expect(instance.deleteWorkspace(headers, primary.workspace.slug, primary.workspace.name)).resolves.toMatchObject({
      id: secondary.id,
    })
    expect(await instance.repository.workspaceById(primary.workspace.id)).toBeUndefined()
    expect(await (await instance.repository.scoped(secondary.id)).managedStorageEligible(primary.identity.id, 1)).toBe(true)
    expect(await instance.repository.managedStorageDeletionQueue()).toEqual([primary.workspace.id])

    await resetApp()
    instance = await app()

    expect(clear).toHaveBeenCalledTimes(2)
    expect(await instance.repository.managedStorageDeletionQueue()).toEqual([])
  })

  it('does not clear managed storage when workspace deletion fails', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-rejected-managed-delete-'))
    vi.stubEnv('DATA_DIR', path.join(temporary, 'data'))
    vi.stubEnv('PRINTS_DIR', path.join(temporary, 'prints'))
    vi.stubEnv('STLQUEST_HOSTED', 'true')
    vi.stubEnv('STLQUEST_HOSTED_STORAGE_BUCKET', 'models')
    vi.stubEnv('STLQUEST_HOSTED_STORAGE_ENDPOINT', 'https://storage.example.com')
    vi.stubEnv('STLQUEST_HOSTED_STORAGE_ACCESS_KEY_ID', 'access')
    vi.stubEnv('STLQUEST_HOSTED_STORAGE_SECRET_ACCESS_KEY', 'secret')
    const { S3AssetStore } = await import('../adapters/s3')
    vi.spyOn(S3AssetStore.prototype, 'initialize').mockResolvedValue(undefined)
    vi.spyOn(S3AssetStore.prototype, 'writable').mockResolvedValue(undefined)
    vi.spyOn(S3AssetStore.prototype, 'inventory').mockResolvedValue({ files: 1, folders: 0, bytes: 4, entries: [], truncated: false })
    vi.spyOn(S3AssetStore.prototype, 'sweepTrash').mockResolvedValue(undefined)
    const clear = vi.spyOn(S3AssetStore.prototype, 'clear').mockResolvedValue(undefined)
    const { app } = await import('./app')
    const instance = await app()
    const signup = await instance.auth.api.signUpEmail({
      body: { email: 'rejected-delete@example.com', password: 'password1234', name: 'Owner' },
      returnHeaders: true,
    })
    const headers = new Headers({
      cookie: signup.headers
        .getSetCookie()
        .map((cookie) => cookie.split(';')[0])
        .join('; '),
    })
    const primary = await instance.workspace(headers)
    await instance.createWorkspace(headers, 'Remaining workspace')
    const { encryptSetting } = await import('./integrations')
    await primary.repository.setSettings({ storageEncrypted: encryptSetting({ adapter: 'managed' }) }, ['storage'])
    await primary.repository.claimManagedStorage(primary.identity.id, 1)
    vi.spyOn(instance.auth.api, 'deleteOrganization').mockRejectedValueOnce(new Error('database unavailable'))

    await expect(instance.deleteWorkspace(headers, primary.workspace.slug, primary.workspace.name)).rejects.toThrow('database unavailable')

    expect(clear).not.toHaveBeenCalled()
    expect(await instance.repository.workspaceById(primary.workspace.id)).toBeDefined()
  })
  it('deletes an account with its owned requests and the workspaces where it is the only member', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-delete-account-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    process.env.PRINTS_DIR = path.join(temporary, 'prints')
    const { app } = await import('./app')
    const instance = await app()
    const adminHeaders = await signUp(instance, 'admin@example.com', 'Admin')
    const makerHeaders = await signUp(instance, 'maker@example.com', 'Maker')
    const admin = await instance.workspace(adminHeaders)
    const adminFarm = await instance.createWorkspace(adminHeaders, 'Admin farm')
    const maker = await instance.workspace(makerHeaders)
    const makerFarm = await instance.createWorkspace(makerHeaders, 'Maker farm')
    await instance.repository.database
      .insert(member)
      .values({ id: 'maker-in-admin-farm', organizationId: adminFarm.id, userId: maker.identity.id, role: 'member', createdAt: new Date() })
      .run()
    const sharedRequestId = await (
      await instance.repository.scoped(adminFarm.id)
    ).createRequest({
      name: 'Shared',
      fileName: 'shared.stl',
      filePath: 'todo/shared.stl',
      quantity: 1,
      ownerUserId: maker.identity.id,
    })
    await (await instance.workspace(makerHeaders, makerFarm.slug)).assets.write('todo/own.stl', new Uint8Array([1, 2, 3]))
    const makerStorage = path.join(process.env.PRINTS_DIR, makerFarm.id)

    await expect(instance.deleteAccount(adminHeaders, admin.identity.id)).rejects.toThrow()
    await expect(instance.deleteAccount(adminHeaders, maker.identity.id)).resolves.toEqual({ deletedWorkspaceCount: 1 })

    expect(await instance.repository.workspaceById(makerFarm.id)).toBeUndefined()
    await expect(fs.promises.stat(makerStorage)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await (await instance.repository.scoped(adminFarm.id)).getRequest(sharedRequestId)).toBeUndefined()
    expect(await instance.repository.workspaceById(adminFarm.id)).toBeDefined()
    expect(await instance.repository.workspaceById(maker.workspace.id)).toBeDefined()
    expect(await instance.repository.listAccounts()).not.toContainEqual(expect.objectContaining({ id: maker.identity.id }))
  })

  it('refuses to delete the only owner of a workspace that has other members', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-delete-sole-owner-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    process.env.PRINTS_DIR = path.join(temporary, 'prints')
    const { app } = await import('./app')
    const instance = await app()
    const adminHeaders = await signUp(instance, 'admin@example.com', 'Admin')
    const ownerHeaders = await signUp(instance, 'owner@example.com', 'Owner')
    const requesterHeaders = await signUp(instance, 'requester@example.com', 'Requester')
    await instance.workspace(adminHeaders)
    const owner = await instance.workspace(ownerHeaders)
    const ownerFarm = await instance.createWorkspace(ownerHeaders, 'Owner farm')
    const requester = await instance.workspace(requesterHeaders)
    await instance.repository.database
      .insert(member)
      .values({
        id: 'requester-in-owner-farm',
        organizationId: ownerFarm.id,
        userId: requester.identity.id,
        role: 'member',
        createdAt: new Date(),
      })
      .run()

    await expect(instance.deleteAccount(adminHeaders, owner.identity.id)).rejects.toMatchObject({ status: 409 })
    await expect(instance.auth.api.removeUser({ body: { userId: owner.identity.id }, headers: adminHeaders })).rejects.toMatchObject({
      statusCode: 409,
    })

    expect(await instance.repository.workspaceById(ownerFarm.id)).toBeDefined()
    expect(await instance.repository.listAccounts()).toContainEqual(expect.objectContaining({ id: owner.identity.id }))
    expect(await instance.repository.listWorkspacesForUser(requester.identity.id)).toContainEqual(
      expect.objectContaining({ id: ownerFarm.id }),
    )
  })

  it('refuses to delete a user whose subscription can still be billed', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-delete-subscriber-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    process.env.PRINTS_DIR = path.join(temporary, 'prints')
    const { app } = await import('./app')
    const instance = await app()
    const adminHeaders = await signUp(instance, 'admin@example.com', 'Admin')
    const subscriberHeaders = await signUp(instance, 'subscriber@example.com', 'Subscriber')
    await instance.workspace(adminHeaders)
    const subscriber = await instance.workspace(subscriberHeaders)
    const now = new Date()
    await instance.repository.database
      .insert(subscription)
      .values({
        id: 'subscriber-plan',
        plan: 'supporter',
        referenceId: subscriber.identity.id,
        status: 'past_due',
        createdAt: now,
        updatedAt: now,
      })
      .run()

    await expect(instance.deleteAccount(adminHeaders, subscriber.identity.id)).rejects.toMatchObject({ status: 409 })
    expect(await instance.auth.api.getSession({ headers: subscriberHeaders })).toMatchObject({ user: { id: subscriber.identity.id } })
  })

  it('deletes a user whose subscription has been cancelled', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-delete-former-subscriber-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    process.env.PRINTS_DIR = path.join(temporary, 'prints')
    const { app } = await import('./app')
    const instance = await app()
    const adminHeaders = await signUp(instance, 'admin@example.com', 'Admin')
    const formerHeaders = await signUp(instance, 'former@example.com', 'Former')
    await instance.workspace(adminHeaders)
    const former = await instance.workspace(formerHeaders)
    await instance.createWorkspace(formerHeaders, 'Former farm')
    const now = new Date()
    await instance.repository.database
      .insert(subscription)
      .values({ id: 'former-plan', plan: 'supporter', referenceId: former.identity.id, status: 'canceled', createdAt: now, updatedAt: now })
      .run()

    await expect(instance.deleteAccount(adminHeaders, former.identity.id)).resolves.toEqual({ deletedWorkspaceCount: 1 })
  })

  it('deletes nothing and keeps the user signed in while a storage migration pauses file changes', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-delete-during-migration-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    process.env.PRINTS_DIR = path.join(temporary, 'prints')
    const { app } = await import('./app')
    const instance = await app()
    const adminHeaders = await signUp(instance, 'admin@example.com', 'Admin')
    const makerHeaders = await signUp(instance, 'maker@example.com', 'Maker')
    const shared = await instance.workspace(adminHeaders)
    const maker = await instance.workspace(makerHeaders)
    const makerFarm = await instance.createWorkspace(makerHeaders, 'Maker farm')
    const requestId = await (
      await instance.repository.scoped(makerFarm.id)
    ).createRequest({ name: 'Own', fileName: 'own.stl', filePath: 'todo/own.stl', quantity: 1, ownerUserId: maker.identity.id })

    await shared.storageMigration.withAssetsLocked(async () => {
      await expect(instance.deleteAccount(adminHeaders, maker.identity.id)).rejects.toMatchObject({ status: 423 })
    })

    expect(await instance.auth.api.getSession({ headers: makerHeaders })).toMatchObject({ user: { id: maker.identity.id } })
    expect(await (await instance.repository.scoped(makerFarm.id)).getRequest(requestId)).toBeDefined()
    expect(await instance.repository.workspaceById(makerFarm.id)).toBeDefined()
  })

  it('answers a direct remove-user call with 423 while a storage migration pauses file changes', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-app-remove-user-during-migration-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    process.env.PRINTS_DIR = path.join(temporary, 'prints')
    const { app } = await import('./app')
    const instance = await app()
    const adminHeaders = await signUp(instance, 'admin@example.com', 'Admin')
    const makerHeaders = await signUp(instance, 'maker@example.com', 'Maker')
    const shared = await instance.workspace(adminHeaders)
    const maker = await instance.workspace(makerHeaders)

    const response = await shared.storageMigration.withAssetsLocked(
      async () =>
        await instance.auth.handler(
          new Request('http://localhost/api/auth/admin/remove-user', {
            method: 'POST',
            headers: { cookie: adminHeaders.get('cookie')!, origin: 'http://localhost', 'content-type': 'application/json' },
            body: JSON.stringify({ userId: maker.identity.id }),
          }),
        ),
    )

    expect(response.status).toBe(423)
  })
})

describe('distributed cutover upload ownership', () => {
  it('blocks uploads created by a rolled-back local release', async () => {
    const { localActiveUploads } = await import('./app')
    const datastore = { getUpload: vi.fn().mockRejectedValue({ name: 'NoSuchKey' }) }

    expect(await localActiveUploads(new Set(['local-upload']), true, datastore as never)).toBe(true)
  })

  it('allows uploads already stored in shared S3', async () => {
    const { localActiveUploads } = await import('./app')
    const datastore = { getUpload: vi.fn().mockResolvedValue({ id: 'shared-upload' }) }

    expect(await localActiveUploads(new Set(['shared-upload']), true, datastore as never)).toBe(false)
  })
})

function sessionCookies(headers: Headers) {
  const cookies = new Map(headers.getSetCookie().map((cookie) => cookie.split(';')[0].split(/=(.*)/s).slice(0, 2) as [string, string]))
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')
}
