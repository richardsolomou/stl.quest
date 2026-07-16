import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { SqliteRepository } from '../adapters/sqlite'
import { LocalAssetStore } from '../adapters/filesystem'
import { S3AssetStore } from '../adapters/s3'
import { DropboxAssetStore } from '../adapters/dropbox'
import { GoogleDriveAssetStore } from '../adapters/googleDrive'
import { OneDriveAssetStore } from '../adapters/oneDrive'
import { UploadStaging } from '../adapters/staging'
import { TusUploadStore } from '../adapters/tus'
import { LocalEventBus } from '../adapters/events'
import { OptionalPostHogTelemetry } from '../adapters/telemetry'
import { resolveAuthAdapterConfig } from '../adapters/auth'
import { buildEmailDelivery, resolveSmtpConfig } from '../adapters/email'
import { PrintHubService } from '../core/services'
import { AssetGenerationQueue } from './assets/queue'
import { createAuth } from './auth'
import type { BoardConfig, Identity, Repository, StorageConfig, TelemetryConfig, WorkspaceSummary } from '../core/types'
import { logger } from './logger'
import { diagnostics } from './operations'
import {
  decryptSetting,
  encryptSetting,
  getDropboxConnection,
  getGoogleDriveConnection,
  getOneDriveConnection,
  getStoredIntegrationConfig,
  type EncryptedSetting,
  updateOneDriveRefreshToken,
} from './integrations'
import { userImage } from './avatar'
import { acquireDataDirectoryLease, networkFilesystem } from './dataSafety'
import { StorageMigrationCoordinator } from './storageMigration'
import { organization } from '../db/schema'

const singleton = globalThis as typeof globalThis & { __printhub?: ReturnType<typeof createApp> }

export function resolveStorageConfig(repository: Repository): StorageConfig {
  const encrypted = repository.getSetting<EncryptedSetting>('storageEncrypted')
  if (encrypted) return decryptSetting<StorageConfig>(encrypted)
  const configured = repository.getSetting<StorageConfig>('storage')
  if (configured) return configured
  const root = process.env.PRINTS_DIR ?? '/prints'
  return { adapter: 'local', root }
}

export function resolveTelemetryConfig(repository: { getSetting<T>(key: string): T | undefined }): TelemetryConfig {
  return { enabled: repository.getSetting<TelemetryConfig>('telemetry')?.enabled !== false }
}

export function resolveBoardConfig(repository: Repository): BoardConfig {
  return repository.getSetting<BoardConfig>('board') ?? { privateRequests: false }
}

export function workspaceStorageConfig(config: StorageConfig, workspaceId?: string): StorageConfig {
  if (!workspaceId || workspaceId === 'legacy-workspace') return config
  if (config.adapter === 'local') return { ...config, root: path.join(config.root, workspaceId) }
  if (config.adapter === 's3') return { ...config, prefix: [config.prefix, workspaceId].filter(Boolean).join('/') }
  return { ...config, root: [config.root, workspaceId].filter(Boolean).join('/') }
}

export function buildAssetStore(config: StorageConfig, repository?: Repository, workspaceId?: string) {
  const workspaceConfig = workspaceStorageConfig(config, workspaceId)
  if (workspaceConfig.adapter === 's3') return new S3AssetStore(workspaceConfig)
  const settings = repository instanceof SqliteRepository ? deploymentSettings(repository) : repository
  if (workspaceConfig.adapter === 'dropbox') {
    if (!repository) throw new Error('Dropbox storage requires a repository')
    return new DropboxAssetStore(workspaceConfig.root, getDropboxConnection(settings!) ?? { clientId: '', clientSecret: '' })
  }
  if (workspaceConfig.adapter === 'google-drive') {
    if (!repository) throw new Error('Google Drive storage requires a repository')
    return new GoogleDriveAssetStore(workspaceConfig.root, getGoogleDriveConnection(settings!) ?? { clientId: '', clientSecret: '' })
  }
  if (workspaceConfig.adapter === 'onedrive') {
    if (!repository) throw new Error('OneDrive storage requires a repository')
    return new OneDriveAssetStore(
      workspaceConfig.root,
      getOneDriveConnection(settings!) ?? { clientId: '', clientSecret: '' },
      (refreshToken) => updateOneDriveRefreshToken(settings!, refreshToken),
    )
  }
  return new LocalAssetStore(workspaceConfig.root)
}

export function hashInviteToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function deploymentSettings(repository: SqliteRepository) {
  return {
    getSetting: <T>(key: string) => repository.getDeploymentSetting<T>(key),
    setSetting: (key: string, value: unknown) => repository.setDeploymentSetting(key, value),
  }
}

function resolveAuthSecret(repository: SqliteRepository) {
  const existing = repository.getDeploymentSetting<string>('authSecret')
  if (existing) return existing
  const secret = crypto.randomBytes(32).toString('base64url')
  repository.setDeploymentSetting('authSecret', secret)
  return secret
}

type WorkspaceRecord = Omit<WorkspaceSummary, 'role'>

export function resolveHostedAuthUrl() {
  if (process.env.PRINTHUB_HOSTED !== 'true') return undefined
  const configured = process.env.BETTER_AUTH_URL?.trim()
  if (!configured) throw new Error('BETTER_AUTH_URL is required when PRINTHUB_HOSTED=true')
  const url = new URL(configured)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('BETTER_AUTH_URL must use http or https')
  return configured.replace(/\/$/, '')
}

async function createApp() {
  let repository: SqliteRepository | undefined
  const hostedAuthUrl = resolveHostedAuthUrl()
  const dataDirectory = path.resolve(process.env.DATA_DIR ?? '/data')
  const lease = acquireDataDirectoryLease(dataDirectory)
  try {
    const filesystem = networkFilesystem(dataDirectory)
    if (filesystem) logger.warn({ dataDirectory, filesystem }, 'SQLite data directory is on an unsafe network filesystem')
    repository = SqliteRepository.open()
    if (process.env.NODE_ENV === 'test' && repository.listWorkspaces().length === 0) {
      repository.database
        .insert(organization)
        .values({ id: 'test-workspace', name: 'Test workspace', slug: 'test-workspace', createdAt: new Date() })
        .run()
    }

    const staging = new UploadStaging()
    const tusUploads = new TusUploadStore(dataDirectory)
    await staging.initialize()
    const settings = deploymentSettings(repository)
    const telemetry = new OptionalPostHogTelemetry(() => resolveTelemetryConfig(settings).enabled)
    const storedIntegrations = getStoredIntegrationConfig(settings)
    const authConfig = resolveAuthAdapterConfig(storedIntegrations)
    const smtpConfig = resolveSmtpConfig(storedIntegrations)
    const email = buildEmailDelivery(smtpConfig)
    type WorkspaceRuntime = Awaited<ReturnType<typeof createWorkspaceRuntime>>
    const runtimes = new Map<string, WorkspaceRuntime>()
    const pendingRuntimes = new Map<string, Promise<WorkspaceRuntime>>()

    const sessionIdentity = (session: NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>): Identity => {
      const { user } = session
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        image: userImage(user.email, user.image),
        role: user.role === 'admin' ? 'admin' : 'requester',
        deploymentAdmin: user.role === 'admin',
        twoFactorEnabled: user.twoFactorEnabled ?? false,
        impersonatedBy: session.session.impersonatedBy ?? undefined,
      }
    }

    const identity = async (headers: Headers): Promise<Identity | undefined> => {
      const session = await auth.api.getSession({ headers })
      return session ? sessionIdentity(session) : undefined
    }

    const auth = createAuth(repository.database, resolveAuthSecret(repository), {
      onUserDeleting: async (userId) => {
        for (const workspace of repository!.listWorkspaces()) await (await runtime(workspace)).service.removeOwnedRequests(userId)
      },
      claimInvite: (token, recipientEmail) => repository!.claimInviteGlobally(hashInviteToken(token), Date.now(), recipientEmail),
      completeInvite: (id, userId) => repository!.completeInviteGlobally(id, userId),
      auth: { ...authConfig, passwordReset: authConfig.password && email !== undefined },
      email,
      baseURL: hostedAuthUrl,
      trustedOrigins: hostedAuthUrl ? [new URL(hostedAuthUrl).origin] : undefined,
    })

    const requireIdentity = async (headers: Headers) => {
      const found = await identity(headers)
      if (!found) throw new Response('unauthenticated', { status: 401 })
      repository!.ensurePersonalWorkspace(found)
      return found
    }

    const runtime = async (workspace: WorkspaceRecord) => {
      const current = runtimes.get(workspace.id)
      if (current) return current
      const currentPending = pendingRuntimes.get(workspace.id)
      if (currentPending) return currentPending
      const pending = createWorkspaceRuntime(repository!, workspace, staging, tusUploads, telemetry)
      pendingRuntimes.set(workspace.id, pending)
      try {
        const created = await pending
        runtimes.set(workspace.id, created)
        return created
      } finally {
        pendingRuntimes.delete(workspace.id)
      }
    }

    const activeUploadIds = new Set<string>()
    for (const workspace of repository.listWorkspaces()) {
      const scopedRepository = repository.scoped(workspace.id)
      for (const uploadId of scopedRepository.expireUploads(Date.now())) await staging.remove(staging.uploadPart(uploadId))
      for (const uploadId of scopedRepository.activeUploadIds(Date.now())) activeUploadIds.add(uploadId)
    }
    await staging.sweepUploads(activeUploadIds)
    const { cleanExpiredTusUploads } = await import('./uploads')
    await cleanExpiredTusUploads()
    const workspaceMembership = async (headers: Headers, workspaceSlug?: string) => {
      const session = await auth.api.getSession({ headers })
      if (!session) throw new Response('unauthenticated', { status: 401 })
      const baseIdentity = sessionIdentity(session)
      const personalWorkspace = repository!.ensurePersonalWorkspace(baseIdentity)
      const workspaces = repository!.listWorkspacesForUser(baseIdentity.id)
      if (workspaceSlug) {
        const membership = workspaces.find((candidate) => candidate.slug === workspaceSlug)
        if (!membership) throw new Response('workspace not found', { status: 404 })
        return { baseIdentity, membership }
      }
      const membership =
        workspaces.find((candidate) => candidate.id === session.session.activeOrganizationId) ?? personalWorkspace ?? workspaces[0]
      if (!membership) throw new Response('workspace not found', { status: 404 })
      if (session.session.activeOrganizationId !== membership.id) {
        await auth.api.setActiveOrganization({ body: { organizationId: membership.id }, headers })
      }
      return { baseIdentity, membership }
    }

    const workspace = async (headers: Headers, workspaceSlug?: string) => {
      const { baseIdentity, membership } = await workspaceMembership(headers, workspaceSlug)
      const workspaceRuntime = await runtime(membership)
      const workspaceIdentity: Identity = {
        ...baseIdentity,
        role: membership.role === 'member' ? 'requester' : 'admin',
        workspaceRole: membership.role,
        workspaceId: membership.id,
        workspaceSlug: membership.slug,
      }
      return { ...workspaceRuntime, workspace: membership, identity: workspaceIdentity }
    }

    const setActiveWorkspace = async (workspaceId: string, headers: Headers) => {
      const baseIdentity = await requireIdentity(headers)
      const membership = repository!.listWorkspacesForUser(baseIdentity.id).find((candidate) => candidate.id === workspaceId)
      if (!membership) throw new Response('workspace not found', { status: 404 })
      await auth.api.setActiveOrganization({ body: { organizationId: membership.id }, headers })
      return membership
    }

    const createWorkspace = async (headers: Headers, name: string) => {
      const { baseIdentity, membership } = await workspaceMembership(headers)
      const source = await runtime(membership)
      return repository!.createWorkspace(baseIdentity, name, { storageEncrypted: encryptSetting(source.storage) })
    }

    const deleteWorkspace = async (headers: Headers, workspaceSlug: string, confirmation: string) => {
      const { baseIdentity, membership } = await workspaceMembership(headers, workspaceSlug)
      if (membership.role !== 'owner') throw new Response('only the workspace owner can delete it', { status: 403 })
      if (confirmation !== membership.name) throw new Response('workspace name does not match', { status: 400 })
      const workspaces = repository!.listWorkspacesForUser(baseIdentity.id)
      if (workspaces.length <= 1) throw new Response('you cannot delete your only workspace', { status: 409 })
      const nextWorkspace = workspaces.find((candidate) => candidate.id !== membership.id)!
      const ownerReplacement = workspaces.find((candidate) => candidate.id !== membership.id && candidate.role === 'owner')
      const wasPersonal = repository!.isPersonalWorkspace(baseIdentity.id, membership.id)
      const storage = workspaceStorageConfig(resolveStorageConfig(repository!.scoped(membership.id)), membership.id)
      const pendingRuntime = pendingRuntimes.get(membership.id)
      const workspaceRuntime = runtimes.get(membership.id) ?? (pendingRuntime ? await pendingRuntime : undefined)
      await workspaceRuntime?.close()
      runtimes.delete(membership.id)
      pendingRuntimes.delete(membership.id)
      await auth.api.deleteOrganization({ body: { organizationId: membership.id }, headers })
      if (wasPersonal && ownerReplacement) repository!.setPersonalWorkspace(baseIdentity.id, ownerReplacement.id)
      await auth.api.setActiveOrganization({ body: { organizationId: nextWorkspace.id }, headers })
      if (storage.adapter === 'local' && membership.id !== 'legacy-workspace') {
        try {
          await fs.promises.rm(storage.root, { recursive: true, force: true })
        } catch (error) {
          logger.warn({ err: error, workspaceId: membership.id, root: storage.root }, 'deleted workspace but could not remove local files')
        }
      }
      return nextWorkspace
    }

    const publicWorkspace = async (slug: string) => {
      const found = repository!.workspaceBySlug(slug)
      if (!found) throw new Response('workspace not found', { status: 404 })
      return runtime(found)
    }

    const defaultWorkspaceRuntime = async () => {
      const defaultWorkspace = repository!.listWorkspaces()[0]
      if (!defaultWorkspace) throw new Error('no workspace is available')
      return runtime(defaultWorkspace)
    }
    let closed = false
    const close = async () => {
      if (closed) return
      closed = true
      try {
        await Promise.all([...runtimes.values()].map((workspaceRuntime) => workspaceRuntime.close()))
      } finally {
        repository?.close()
        lease.release()
      }
    }

    return {
      repository,
      staging,
      telemetry,
      auth,
      authCapabilities: {
        password: authConfig.password,
        passwordReset: authConfig.password && email !== undefined,
        socialProviders: authConfig.socialProviders,
      },
      emailCapabilities: { configured: email !== undefined },
      emailDelivery: email,
      integrationConfig: storedIntegrations ?? { passwordEnabled: true },
      identity,
      requireIdentity,
      createWorkspace,
      deleteWorkspace,
      setActiveWorkspace,
      workspace,
      publicWorkspace,
      defaultWorkspaceRuntime,
      listWorkspaces: (userId: string) => repository!.listWorkspacesForUser(userId),
      close,
    }
  } catch (error) {
    repository?.close()
    lease.release()
    throw error
  }
}

async function createWorkspaceRuntime(
  rootRepository: SqliteRepository,
  workspace: WorkspaceRecord,
  staging: UploadStaging,
  tusUploads: TusUploadStore,
  telemetry: OptionalPostHogTelemetry,
) {
  const repository = rootRepository.scoped(workspace.id)
  const storage = resolveStorageConfig(repository)
  const assets = buildAssetStore(storage, repository, workspace.id)
  const events = new LocalEventBus()
  let assertAssetsMutable: () => void = () => undefined
  const service = new PrintHubService(repository, assets, staging, events, telemetry, tusUploads, () => assertAssetsMutable())
  let storageReady = false
  let storageRecovery: Promise<boolean> | undefined
  let assetQueue: AssetGenerationQueue
  const recoverStorage = () => {
    if (storageRecovery) return storageRecovery
    storageRecovery = (async () => {
      try {
        await assets.initialize()
        await service.recoverOperations()
        await assets.sweepTrash()
        storageReady = true
        assetQueue?.backfill()
        return true
      } catch (error) {
        storageReady = false
        logger.warn({ err: error, workspaceId: workspace.id }, 'workspace storage is not ready')
        return false
      } finally {
        storageRecovery = undefined
      }
    })()
    return storageRecovery
  }
  await recoverStorage()
  repository.reconcileWorkflow()
  assetQueue = new AssetGenerationQueue(repository, assets, events, telemetry)
  const storageMigration = new StorageMigrationCoordinator(
    repository,
    assets,
    storage,
    assetQueue,
    (config) => buildAssetStore(config, repository, workspace.id),
    async () => {
      events.publish('settings.changed')
      await resetApp()
    },
  )
  assertAssetsMutable = () => storageMigration.assertAssetsMutable()
  if (storageReady && !storageMigration.active()) assetQueue.backfill()
  if (storageReady) storageMigration.resume()
  const refreshDiagnostics = () => diagnostics(repository, storage, assets)
  if (storageReady) await refreshDiagnostics()
  let closed = false
  return {
    repository,
    assets,
    events,
    service,
    assetQueue,
    storageMigration,
    storage,
    get storageReady() {
      return storageReady
    },
    recoverStorage,
    refreshDiagnostics,
    close: async () => {
      if (closed) return
      closed = true
      events.close()
      await assetQueue.shutdown()
    },
  }
}

export function app() {
  if (singleton.__printhub) return singleton.__printhub
  const pending = createApp()
  singleton.__printhub = pending
  void pending.catch(() => {
    if (singleton.__printhub === pending) delete singleton.__printhub
  })
  return pending
}

export async function resetApp() {
  const running = singleton.__printhub
  delete singleton.__printhub
  const instance = running ? await running.catch(() => undefined) : undefined
  await instance?.close()
  logger.info('application singleton reset')
}

export async function shutdownApp() {
  const running = singleton.__printhub
  delete singleton.__printhub
  const instance = running ? await running.catch(() => undefined) : undefined
  await instance?.close()
}

const lifecycle = globalThis as typeof globalThis & { __printhubSignals?: boolean }
if (!lifecycle.__printhubSignals && process.env.NODE_ENV !== 'test') {
  lifecycle.__printhubSignals = true
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdownApp().finally(() => process.exit(0))
    })
  }
}
