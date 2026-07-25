import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DrizzleRepository } from '../db/repository'
import { LocalAssetStore } from '../adapters/filesystem'
import { S3AssetStore } from '../adapters/s3'
import { WebDAVAssetStore } from '../adapters/webdav'
import { DropboxAssetStore } from '../adapters/dropbox'
import { GoogleDriveAssetStore } from '../adapters/googleDrive'
import { OneDriveAssetStore } from '../adapters/oneDrive'
import { UploadStaging } from '../adapters/staging'
import { TusUploadStore } from '../adapters/tus'
import { LocalEventBus } from '../adapters/events'
import { OptionalPostHogTelemetry } from '../adapters/telemetry'
import { resolveAuthAdapterConfig } from '../adapters/auth'
import { buildEmailDelivery, resolveSmtpConfig } from '../adapters/email'
import { STLQuestService } from '../core/services'
import { workflow } from '../core/workflow'
import { AssetGenerationQueue } from './assets/queue'
import { createAuth } from './auth'
import type { BoardConfig, Identity, Repository, StorageConfig, StorageMigration, TelemetryConfig, WorkspaceSummary } from '../core/types'
import { logger, setTelemetryExporters } from './logger'
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
import { normalizeAuthHeaders } from './authCookies'
import { acquireDataDirectoryLease, networkFilesystem } from './dataSafety'
import { LEGACY_STORAGE_NAMESPACE_SETTING, STORAGE_MIGRATION_SETTING, StorageMigrationCoordinator } from './storageMigration'
import { organization } from '../db/schema'
import { currentRequest } from './requestContext'
import { pendingAssetMigrations, runAssetMigrations } from './assetMigrations'

const workflowVersion = workflow.statuses.map((status) => status.id).join(':')
const singleton = globalThis as typeof globalThis & {
  __stlquest?: ReturnType<typeof createApp>
  __stlquestWorkflowVersion?: string
  __stlquestWorkflowReconcile?: Promise<void>
}

export async function resolveStorageConfig(repository: Repository): Promise<StorageConfig> {
  const encrypted = await repository.getSetting<EncryptedSetting>('storageEncrypted')
  const configured = encrypted ? decryptSetting<StorageConfig>(encrypted) : await repository.getSetting<StorageConfig>('storage')
  if (configured?.adapter !== 'local') return configured ?? { adapter: 'local', root: path.resolve(process.env.PRINTS_DIR ?? '/prints') }
  return { adapter: 'local', root: path.resolve(process.env.PRINTS_DIR_OVERRIDE?.trim() || configured.root) }
}

export async function resolveTelemetryConfig(repository: { getSetting<T>(key: string): Promise<T | undefined> }): Promise<TelemetryConfig> {
  return { enabled: (await repository.getSetting<TelemetryConfig>('telemetry'))?.enabled !== false }
}

export async function resolveBoardConfig(repository: Repository): Promise<BoardConfig> {
  const stored = await repository.getSetting<Partial<BoardConfig>>('board')
  return { privateRequests: stored?.privateRequests ?? false }
}

export function workspaceStorageConfig(config: StorageConfig, workspaceId?: string, legacyNamespaced = false): StorageConfig {
  if (!workspaceId || (workspaceId === 'legacy-workspace' && !legacyNamespaced)) return config
  return namespacedStorageConfig(config, workspaceId)
}

export function namespacedStorageConfig(config: StorageConfig, workspaceId: string): StorageConfig {
  if (config.adapter === 'local') return { ...config, root: path.join(config.root, workspaceId) }
  if (config.adapter === 's3') return { ...config, prefix: [config.prefix, workspaceId].filter(Boolean).join('/') }
  return { ...config, root: [config.root, workspaceId].filter(Boolean).join('/') }
}

export async function buildAssetStore(config: StorageConfig, repository?: Repository, workspaceId?: string) {
  const legacyNamespaced = workspaceId === 'legacy-workspace' && (await repository?.getSetting(LEGACY_STORAGE_NAMESPACE_SETTING)) === true
  const workspaceConfig = workspaceStorageConfig(config, workspaceId, legacyNamespaced)
  if (workspaceConfig.adapter === 's3') return new S3AssetStore(workspaceConfig)
  if (workspaceConfig.adapter === 'webdav') return new WebDAVAssetStore(workspaceConfig)
  const settings = repository instanceof DrizzleRepository ? deploymentSettings(repository) : repository
  if (workspaceConfig.adapter === 'dropbox') {
    if (!repository) throw new Error('Dropbox storage requires a repository')
    return new DropboxAssetStore(workspaceConfig.root, (await getDropboxConnection(settings!)) ?? { clientId: '', clientSecret: '' })
  }
  if (workspaceConfig.adapter === 'google-drive') {
    if (!repository) throw new Error('Google Drive storage requires a repository')
    return new GoogleDriveAssetStore(
      workspaceConfig.root,
      (await getGoogleDriveConnection(settings!)) ?? { clientId: '', clientSecret: '' },
    )
  }
  if (workspaceConfig.adapter === 'onedrive') {
    if (!repository) throw new Error('OneDrive storage requires a repository')
    return new OneDriveAssetStore(
      workspaceConfig.root,
      (await getOneDriveConnection(settings!)) ?? { clientId: '', clientSecret: '' },
      (refreshToken) => void updateOneDriveRefreshToken(settings!, refreshToken),
    )
  }
  return new LocalAssetStore(workspaceConfig.root)
}

export function hashInviteToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function deploymentSettings(repository: DrizzleRepository) {
  return {
    getSetting: async <T>(key: string) => await repository.getDeploymentSetting<T>(key),
    setSetting: async (key: string, value: unknown) => await repository.setDeploymentSetting(key, value),
  }
}

async function resolveAuthSecret(repository: DrizzleRepository) {
  const existing = await repository.getDeploymentSetting<string>('authSecret')
  if (existing) return existing
  const secret = crypto.randomBytes(32).toString('base64url')
  await repository.setDeploymentSetting('authSecret', secret)
  return secret
}

type WorkspaceRecord = Omit<WorkspaceSummary, 'role'>

export function resolveAuthUrl() {
  const configured = process.env.BETTER_AUTH_URL?.trim()
  if (!configured) return undefined
  const url = new URL(configured)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('BETTER_AUTH_URL must use http or https')
  return configured.replace(/\/$/, '')
}

async function createApp() {
  let repository: DrizzleRepository | undefined
  let telemetry: OptionalPostHogTelemetry | undefined
  const authUrl = resolveAuthUrl()
  const dataDirectory = path.resolve(process.env.DATA_DIR ?? '/data')
  const lease = acquireDataDirectoryLease(dataDirectory)
  try {
    const filesystem = networkFilesystem(dataDirectory)
    if (filesystem && !process.env.DATABASE_URL) {
      logger.warn({ dataDirectory, filesystem }, 'SQLite data directory is on an unsafe network filesystem')
    }
    repository = await DrizzleRepository.open()
    if (process.env.NODE_ENV === 'test' && (await repository.listWorkspaces()).length === 0) {
      await repository.database
        .insert(organization)
        .values({ id: 'test-workspace', name: 'Test workspace', slug: 'test-workspace', createdAt: new Date() })
        .run()
    }

    const staging = new UploadStaging()
    const tusUploads = new TusUploadStore(dataDirectory)
    await staging.initialize()
    const settings = deploymentSettings(repository)
    const telemetryConfig = await resolveTelemetryConfig(settings)
    const appTelemetry = new OptionalPostHogTelemetry(() => telemetryConfig.enabled)
    telemetry = appTelemetry
    await appTelemetry.start()
    setTelemetryExporters({
      exception: (error, properties) => void appTelemetry.exception(error, properties),
      log: (record) => void appTelemetry.log(record),
    })
    const storedIntegrations = await getStoredIntegrationConfig(settings)
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
        role: 'requester',
        superAdmin: user.role === 'super_admin',
        twoFactorEnabled: user.twoFactorEnabled ?? false,
        impersonatedBy: session.session.impersonatedBy ?? undefined,
      }
    }

    const identity = async (headers: Headers): Promise<Identity | undefined> => {
      const session = await auth.api.getSession({ headers: normalizeAuthHeaders(headers) })
      return session ? sessionIdentity(session) : undefined
    }

    const auth = createAuth(repository.database, await resolveAuthSecret(repository), {
      onUserDeleting: async (userId) => {
        for (const workspace of await repository!.listWorkspaces()) await (await runtime(workspace)).service.removeOwnedRequests(userId)
      },
      claimInvite: async (token, recipientEmail) =>
        await repository!.claimInviteGlobally(hashInviteToken(token), Date.now(), recipientEmail),
      completeInvite: async (id, userId) => await repository!.completeInviteGlobally(id, userId),
      auth: { ...authConfig, passwordReset: authConfig.password && email !== undefined },
      email,
      baseURL: authUrl,
      trustedOrigins: authUrl ? [new URL(authUrl).origin] : undefined,
      onError: (error) => {
        const request = currentRequest()
        logger.error(
          { err: error, action: 'better_auth', path: request ? new URL(request.url).pathname : undefined },
          'authentication failed',
        )
      },
    })

    const requireIdentity = async (headers: Headers) => {
      const found = await identity(headers)
      if (!found) throw new Response('unauthenticated', { status: 401 })
      await repository!.ensurePersonalWorkspace(found)
      return found
    }

    const runtime = async (workspace: WorkspaceRecord) => {
      const current = runtimes.get(workspace.id)
      if (current) return current
      const currentPending = pendingRuntimes.get(workspace.id)
      if (currentPending) return currentPending
      const pending = createWorkspaceRuntime(repository!, workspace, staging, tusUploads, appTelemetry)
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
    for (const workspace of await repository.listWorkspaces()) {
      const scopedRepository = await repository.scoped(workspace.id)
      for (const uploadId of await scopedRepository.expireUploads(Date.now())) await staging.remove(staging.uploadPart(uploadId))
      for (const uploadId of await scopedRepository.activeUploadIds(Date.now())) activeUploadIds.add(uploadId)
    }
    await staging.sweepUploads(activeUploadIds)
    const { cleanExpiredTusUploads } = await import('./uploads')
    await cleanExpiredTusUploads()
    for (const workspace of await repository.listWorkspaces()) {
      const scopedRepository = await repository.scoped(workspace.id)
      if (
        !(await pendingAssetMigrations(scopedRepository)) ||
        (await scopedRepository.listRequests()).length > 0 ||
        (await scopedRepository.listOperations()).length > 0
      )
        continue
      const storage = await resolveStorageConfig(scopedRepository)
      const assets = await buildAssetStore(storage, scopedRepository, workspace.id)
      await runAssetMigrations(scopedRepository, assets).catch((error) => {
        logger.warn({ err: error, workspaceId: workspace.id }, 'empty workspace asset layout cleanup failed')
      })
    }
    const workspaceMembership = async (headers: Headers, workspaceSlug?: string) => {
      headers = normalizeAuthHeaders(headers)
      const session = await auth.api.getSession({ headers })
      if (!session) throw new Response('unauthenticated', { status: 401 })
      const baseIdentity = sessionIdentity(session)
      const personalWorkspace = await repository!.ensurePersonalWorkspace(baseIdentity)
      const workspaces = await repository!.listWorkspacesForUser(baseIdentity.id)
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
      headers = normalizeAuthHeaders(headers)
      const baseIdentity = await requireIdentity(headers)
      const membership = (await repository!.listWorkspacesForUser(baseIdentity.id)).find((candidate) => candidate.id === workspaceId)
      if (!membership) throw new Response('workspace not found', { status: 404 })
      await auth.api.setActiveOrganization({ body: { organizationId: membership.id }, headers })
      return membership
    }

    const createWorkspace = async (headers: Headers, name: string) => {
      const { baseIdentity, membership } = await workspaceMembership(headers)
      const source = await runtime(membership)
      return await repository!.createWorkspace(baseIdentity, name, { storageEncrypted: encryptSetting(source.storage) })
    }

    const deleteWorkspace = async (headers: Headers, workspaceSlug: string, confirmation: string) => {
      const { baseIdentity, membership } = await workspaceMembership(headers, workspaceSlug)
      if (membership.role !== 'owner') throw new Response('you cannot delete this workspace', { status: 403 })
      if (confirmation !== membership.name) throw new Response('workspace name does not match', { status: 400 })
      const workspaces = await repository!.listWorkspacesForUser(baseIdentity.id)
      if (workspaces.length <= 1) throw new Response('you cannot delete your only workspace', { status: 409 })
      const nextWorkspace = workspaces.find((candidate) => candidate.id !== membership.id)!
      const ownerReplacement = workspaces.find((candidate) => candidate.id !== membership.id && candidate.role === 'owner')
      const wasPersonal = await repository!.isPersonalWorkspace(baseIdentity.id, membership.id)
      const scopedRepository = await repository!.scoped(membership.id)
      const legacyNamespaced = (await scopedRepository.getSetting(LEGACY_STORAGE_NAMESPACE_SETTING)) === true
      const storage = workspaceStorageConfig(await resolveStorageConfig(scopedRepository), membership.id, legacyNamespaced)
      const storageNamespaced = membership.id !== 'legacy-workspace' || legacyNamespaced
      const pendingRuntime = pendingRuntimes.get(membership.id)
      const workspaceRuntime = runtimes.get(membership.id) ?? (pendingRuntime ? await pendingRuntime : undefined)
      await workspaceRuntime?.close()
      runtimes.delete(membership.id)
      pendingRuntimes.delete(membership.id)
      await auth.api.deleteOrganization({ body: { organizationId: membership.id }, headers })
      if (wasPersonal && ownerReplacement) await repository!.setPersonalWorkspace(baseIdentity.id, ownerReplacement.id)
      await auth.api.setActiveOrganization({ body: { organizationId: nextWorkspace.id }, headers })
      if (storage.adapter === 'local' && storageNamespaced) {
        try {
          await fs.promises.rm(storage.root, { recursive: true, force: true })
        } catch (error) {
          logger.warn({ err: error, workspaceId: membership.id, root: storage.root }, 'deleted workspace but could not remove local files')
        }
      }
      void appTelemetry.capture(baseIdentity.id, 'workspace_deleted', {}).catch(() => undefined)
      return nextWorkspace
    }

    const publicWorkspace = async (slug: string) => {
      const found = await repository!.workspaceBySlug(slug)
      if (!found) throw new Response('workspace not found', { status: 404 })
      return runtime(found)
    }

    const defaultWorkspaceRuntime = async () => {
      const defaultWorkspace = (await repository!.listWorkspaces())[0]
      if (!defaultWorkspace) throw new Error('no workspace is available')
      return runtime(defaultWorkspace)
    }
    let closed = false
    const close = async () => {
      if (closed) return
      closed = true
      logger.info({ event: 'application_stopping', activeWorkspaces: runtimes.size }, 'application stopping')
      try {
        await Promise.all([...runtimes.values()].map((workspaceRuntime) => workspaceRuntime.close()))
      } finally {
        try {
          await appTelemetry.shutdown()
        } finally {
          setTelemetryExporters(undefined)
          await repository?.close()
          lease.release()
        }
      }
    }

    logger.info(
      {
        event: 'application_started',
        workspaces: (await repository.listWorkspaces()).length,
        passwordAuth: authConfig.password,
        socialProviders: authConfig.socialProviders.length,
        telemetryEnabled: telemetryConfig.enabled,
      },
      'application started',
    )

    return {
      repository,
      staging,
      telemetry: appTelemetry,
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
      listWorkspaces: async (userId: string) => await repository!.listWorkspacesForUser(userId),
      close,
    }
  } catch (error) {
    logger.error({ err: error, event: 'application_start_failed' }, 'application startup failed')
    try {
      await telemetry?.shutdown()
    } finally {
      setTelemetryExporters(undefined)
      await repository?.close()
      lease.release()
    }
    throw error
  }
}

async function createWorkspaceRuntime(
  rootRepository: DrizzleRepository,
  workspace: WorkspaceRecord,
  staging: UploadStaging,
  tusUploads: TusUploadStore,
  telemetry: OptionalPostHogTelemetry,
) {
  const repository = await rootRepository.scoped(workspace.id)
  const storage = await resolveStorageConfig(repository)
  const assets = await buildAssetStore(storage, repository, workspace.id)
  const events = new LocalEventBus()
  let assertAssetsMutable: () => Promise<void> = async () => undefined
  const service = new STLQuestService(repository, assets, staging, events, telemetry, tusUploads, () => assertAssetsMutable())
  let storageReady = false
  let storageRecovery: Promise<boolean> | undefined
  let assetQueue: AssetGenerationQueue
  const recoverStorage = () => {
    if (storageRecovery) return storageRecovery
    storageRecovery = (async () => {
      try {
        await assets.initialize()
        await service.recoverOperations()
        const migration = await repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING)
        if (migration?.state !== 'running') await runAssetMigrations(repository, assets)
        await assets.sweepTrash()
        storageReady = true
        await assetQueue?.backfill()
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
  await repository.reconcileWorkflow()
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
    telemetry,
  )
  assertAssetsMutable = () => storageMigration.assertAssetsMutable()
  if (storageReady && !(await storageMigration.active())) await assetQueue.backfill()
  if (storageReady) {
    const migration = await storageMigration.status()
    if (workspace.id === 'legacy-workspace' && !(await repository.getSetting(LEGACY_STORAGE_NAMESPACE_SETTING)) && !migration) {
      await storageMigration.startLegacyNamespace(namespacedStorageConfig(storage, workspace.id))
    } else {
      await storageMigration.resume()
    }
  }
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
  if (singleton.__stlquest) {
    const running = singleton.__stlquest
    if (singleton.__stlquestWorkflowVersion === workflowVersion) return running
    const reconciliation =
      singleton.__stlquestWorkflowReconcile ??
      running.then(async (instance) => {
        for (const workspace of await instance.repository.listWorkspaces())
          await (await instance.repository.scoped(workspace.id)).reconcileWorkflow()
        singleton.__stlquestWorkflowVersion = workflowVersion
      })
    singleton.__stlquestWorkflowReconcile = reconciliation
    const clearReconciliation = () => {
      if (singleton.__stlquestWorkflowReconcile === reconciliation) delete singleton.__stlquestWorkflowReconcile
    }
    void reconciliation.then(clearReconciliation, clearReconciliation)
    return Promise.all([running, reconciliation]).then(([instance]) => instance)
  }
  const pending = createApp()
  singleton.__stlquest = pending
  void pending.then(
    () => {
      singleton.__stlquestWorkflowVersion = workflowVersion
    },
    () => undefined,
  )
  void pending.catch(() => {
    if (singleton.__stlquest === pending) delete singleton.__stlquest
  })
  return pending
}

export async function resetApp() {
  const running = singleton.__stlquest
  delete singleton.__stlquest
  delete singleton.__stlquestWorkflowVersion
  delete singleton.__stlquestWorkflowReconcile
  const instance = running ? await running.catch(() => undefined) : undefined
  await instance?.close()
  logger.info('application singleton reset')
}

export async function shutdownApp() {
  const running = singleton.__stlquest
  delete singleton.__stlquest
  delete singleton.__stlquestWorkflowVersion
  delete singleton.__stlquestWorkflowReconcile
  const instance = running ? await running.catch(() => undefined) : undefined
  await instance?.close()
}

const lifecycle = globalThis as typeof globalThis & { __stlquestSignals?: boolean }
if (!lifecycle.__stlquestSignals && process.env.NODE_ENV !== 'test') {
  lifecycle.__stlquestSignals = true
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdownApp().finally(() => process.exit(0))
    })
  }
}
