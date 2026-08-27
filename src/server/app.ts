import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { clearGlobalSingleton, globalAsyncSingleton, globalSingleton, peekGlobalSingleton } from 'ras-stack/server'
import { DrizzleRepository } from '../db/repository'
import { LocalAssetStore } from '../adapters/filesystem'
import { S3AssetStore } from '../adapters/s3'
import { WebDAVAssetStore } from '../adapters/webdav'
import { DropboxAssetStore } from '../adapters/dropbox'
import { BoxAssetStore } from '../adapters/box'
import { GoogleDriveAssetStore } from '../adapters/googleDrive'
import { OneDriveAssetStore } from '../adapters/oneDrive'
import { UploadStaging } from '../adapters/staging'
import { TusUploadStore } from '../adapters/tus'
import { RealtimeEventBus, RealtimePublisher } from '../adapters/events'
import { OptionalPostHogTelemetry, withTelemetryContext } from '../adapters/telemetry'
import { resolveAuthAdapterConfig } from '../adapters/auth'
import { buildEmailDelivery, resolveSmtpConfig } from '../adapters/email'
import { cloudStorageProviderName } from '../core/auth'
import { STLQuestService } from '../core/services'
import { workflow } from '../core/workflow'
import { AssetGenerationQueue, resolveAssetQueueLimits } from './assets/queue'
import { createAuth } from './auth'
import type {
  BoardConfig,
  Identity,
  Repository,
  StorageConfig,
  StorageMigration,
  TelemetryConfig,
  UploadStagingArea,
  UploadStore,
  WorkspaceSummary,
} from '../core/types'
import { logger, setTelemetryExporters } from './logger'
import { diagnostics } from './operations'
import { decryptSetting, getStoredIntegrationConfig, type EncryptedSetting } from './integrations'
import {
  adoptDeploymentCloudConnections,
  cloudStorageApp,
  cloudStorageConnection,
  isCloudStorageProvider,
  rotateCloudRefreshToken,
} from './cloudStorage'
import { userImage } from './avatar'
import { normalizeAuthHeaders } from './authCookies'
import { acquireDataDirectoryLease, networkFilesystem } from './dataSafety'
import {
  LEGACY_STORAGE_NAMESPACE_SETTING,
  LEGACY_CLOUD_STORAGE_CLEANUP_SETTING,
  MANAGED_STORAGE_CLEANUP_SETTING,
  STORAGE_MIGRATION_SETTING,
  STORAGE_RUNTIME_REVISION_SETTING,
  StorageMigrationCoordinator,
  completeManagedStorageCleanup,
  type LegacyCloudStorageCleanup,
} from './storageMigration'
import { organization } from '../db/schema'
import { currentRequest, setRequestIdentity } from './requestContext'
import { pendingAssetMigrations, runAssetMigrations } from './assetMigrations'
import { assertDistributedWorkspaceReadiness, resolveDistributedConfig } from './distributed'
import { createDistributedRuntime, type DistributedRuntime } from './distributedRuntime'
import { isMissingObject } from '../adapters/distributedUploads'
import { realtimeConfig } from './realtime'
import { withWorkLease, type WorkLocker, type WorkLockOptions } from './workLock'
import { WorkspaceRuntimeRegistry } from './workspaceRuntimeRegistry'
import { buildManagedAssetStore, clearManagedStoragePrefix, QuotaAssetStore, QuotaUploadStaging } from './managedStorage'
import { deploymentType, HOSTED_OWNED_WORKSPACE_LIMIT, hostedDeployment } from './hosted'

const workflowVersion = workflow.statuses.map((status) => status.id).join(':')
// Storage recovery runs a full crash-recovery and asset-migration pass, which can run far longer
// than the upload path's 30s default. A replica contending for the lease should wait for the
// current holder to finish rather than time out and boot degraded, so the wait is unbounded; the
// lock is heartbeat-refreshed, so if the holder dies its lease expires and the waiter takes over.
const RECOVERY_LEASE_OPTIONS: WorkLockOptions = { acquireTimeout: Number.POSITIVE_INFINITY, retryInterval: 1_000 }
const DISTRIBUTED_RUNTIME_MODE_SETTING = 'distributed-runtime-mode'
const LEGACY_DISTRIBUTED_RUNTIME_SETTING = 'distributed-runtime-enabled'
type AppLifecycle = { workflowVersion?: string; reconciliation?: Promise<void> }
const appLifecycle = () => globalSingleton<AppLifecycle>('stlquest.lifecycle', () => ({}))
type CloudStorageConfig = Extract<StorageConfig, { adapter: 'dropbox' | 'google-drive' | 'onedrive' | 'box' }>

function isCloudStorageConfig(config: StorageConfig): config is CloudStorageConfig {
  return isCloudStorageProvider(config.adapter)
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

async function processManagedStorageDeletionQueue(repository: DrizzleRepository, onlyWorkspaceId?: string) {
  for (const workspaceId of await repository.managedStorageDeletionQueue()) {
    if (onlyWorkspaceId && workspaceId !== onlyWorkspaceId) continue
    if (await repository.workspaceById(workspaceId)) continue
    try {
      await clearManagedStoragePrefix(workspaceId)
      await repository.completeManagedStorageDeletion(workspaceId)
    } catch (error) {
      logger.warn(
        { err: error, event: 'managed_storage_deletion_cleanup_pending', workspace_id: workspaceId },
        'deleted workspace storage cleanup will retry on startup',
      )
    }
  }
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
  if (config.adapter === 'managed') return config
  if (config.adapter === 'local') return { ...config, root: path.join(config.root, workspaceId) }
  if (config.adapter === 's3') return { ...config, prefix: [config.prefix, workspaceId].filter(Boolean).join('/') }
  if (isCloudStorageConfig(config))
    return {
      ...config,
      root: config.layout === 'workspace-root-v1' ? `stlquest-${workspaceId}` : [config.root, workspaceId].filter(Boolean).join('/'),
    }
  return { ...config, root: [config.root, workspaceId].filter(Boolean).join('/') }
}

export function canonicalCloudStorageConfig(config: StorageConfig): StorageConfig | undefined {
  if (!isCloudStorageConfig(config) || config.layout === 'workspace-root-v1') return undefined
  return { ...config, root: '', layout: 'workspace-root-v1' }
}

export async function buildAssetStore(config: StorageConfig, repository?: Repository, workspaceId?: string, workLocker?: WorkLocker) {
  const legacyNamespaced = workspaceId === 'legacy-workspace' && (await repository?.getSetting(LEGACY_STORAGE_NAMESPACE_SETTING)) === true
  const workspaceConfig = workspaceStorageConfig(config, workspaceId, legacyNamespaced)
  const generatedCloudRoot =
    (config.adapter === 'dropbox' || config.adapter === 'google-drive' || config.adapter === 'onedrive' || config.adapter === 'box') &&
    config.layout === 'workspace-root-v1'
  if (workspaceConfig.adapter === 'managed') {
    if (!workspaceId) throw new Error('managed storage requires a workspace')
    if (!repository) throw new Error('managed storage requires a repository')
    return buildManagedAssetStore(workspaceId, repository, workLocker)
  }
  if (workspaceConfig.adapter === 's3') return new S3AssetStore(workspaceConfig)
  if (workspaceConfig.adapter === 'webdav') return new WebDAVAssetStore(workspaceConfig)
  if (isCloudStorageProvider(workspaceConfig.adapter)) {
    if (!repository) throw new Error(`${cloudStorageProviderName(workspaceConfig.adapter)} storage requires a repository`)
    // App credentials come from the deployment; the authorised account comes from the workspace using it.
    const deployment = repository instanceof DrizzleRepository ? deploymentSettings(repository) : repository
    const provider = workspaceConfig.adapter
    const credentials = {
      ...((await cloudStorageApp(deployment, provider)) ?? { clientId: '', clientSecret: '' }),
      refreshToken: (await cloudStorageConnection(repository, provider))?.refreshToken,
    }
    if (provider === 'dropbox') return new DropboxAssetStore(workspaceConfig.root, credentials)
    if (provider === 'google-drive') return new GoogleDriveAssetStore(workspaceConfig.root, credentials, generatedCloudRoot)
    if (provider === 'box')
      return new BoxAssetStore(
        workspaceConfig.root,
        credentials,
        (refreshToken) => void rotateCloudRefreshToken(repository, provider, refreshToken),
        generatedCloudRoot,
      )
    return new OneDriveAssetStore(
      workspaceConfig.root,
      credentials,
      (refreshToken) => void rotateCloudRefreshToken(repository, provider, refreshToken),
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
  let distributedRuntime: DistributedRuntime | undefined
  const authUrl = resolveAuthUrl()
  const realtime = realtimeConfig()
  const realtimePublisher = new RealtimePublisher(realtime.apiUrl, realtime.apiKey)
  const dataDirectory = path.resolve(process.env.DATA_DIR ?? '/data')
  const distributedConfig = resolveDistributedConfig()
  const lease = distributedConfig ? undefined : acquireDataDirectoryLease(dataDirectory)
  try {
    const filesystem = distributedConfig ? undefined : networkFilesystem(dataDirectory)
    if (filesystem && !process.env.DATABASE_URL) {
      logger.warn({ event: 'unsafe_data_filesystem', filesystem }, 'SQLite data directory is on an unsafe network filesystem')
    }
    distributedRuntime = distributedConfig
      ? await createDistributedRuntime(distributedConfig, (error) =>
          logger.warn({ err: error, event: 'distributed_coordination_failed' }, 'distributed coordination failed'),
        )
      : undefined
    repository = await withWorkLease(distributedRuntime?.workLocker, 'database-migrations', async () => await DrizzleRepository.open())
    if (process.env.NODE_ENV === 'test' && (await repository.listWorkspaces()).length === 0) {
      await repository.database
        .insert(organization)
        .values({ id: 'test-workspace', name: 'Test workspace', slug: 'test-workspace', createdAt: new Date() })
        .run()
    }

    if (distributedConfig) {
      const previousMode = await repository.getDeploymentSetting<'local' | 'distributed'>(DISTRIBUTED_RUNTIME_MODE_SETTING)
      const distributedPreviouslyEnabled =
        previousMode === 'distributed' ||
        (previousMode === undefined && (await repository.getDeploymentSetting<boolean>(LEGACY_DISTRIBUTED_RUNTIME_SETTING)) === true)
      const readiness = await mapConcurrent(await repository.listWorkspaces(), 8, async (workspace) => {
        const scopedRepository = await repository!.scoped(workspace.id)
        const [storage, migration, activeUploadIds] = await Promise.all([
          resolveStorageConfig(scopedRepository),
          scopedRepository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING),
          scopedRepository.activeUploadIds(Date.now()),
        ])
        const hasLocalActiveUploads = await localActiveUploads(activeUploadIds, distributedPreviouslyEnabled, distributedRuntime!.datastore)
        return {
          slug: workspace.slug,
          localStorageInUse: storage.adapter === 'local' && (await scopedRepository.hasRequests()),
          hasActiveUploads: hasLocalActiveUploads,
          storageMigrationRunning: migration?.state === 'running',
        }
      })
      assertDistributedWorkspaceReadiness(readiness)
    }

    const localStaging = distributedRuntime ? undefined : new UploadStaging()
    const staging = distributedRuntime?.staging ?? localStaging!
    const tusUploads = distributedRuntime?.uploads ?? new TusUploadStore(dataDirectory)
    const uploadDatastore = distributedRuntime?.datastore ?? (tusUploads as TusUploadStore).datastore
    const uploadLocker = distributedRuntime?.locker
    await staging.initialize()
    await repository.setDeploymentSetting(DISTRIBUTED_RUNTIME_MODE_SETTING, distributedConfig ? 'distributed' : 'local')
    await processManagedStorageDeletionQueue(repository)
    const settings = deploymentSettings(repository)
    const telemetryConfig = await resolveTelemetryConfig(settings)
    const appTelemetry = new OptionalPostHogTelemetry(() => telemetryConfig.enabled, {
      app_version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'development',
      deployment_type: deploymentType(),
    })
    telemetry = appTelemetry
    await appTelemetry.start()
    setTelemetryExporters({
      exception: (error, properties) => void appTelemetry.exception(error, properties),
      log: (record) => void appTelemetry.log(record),
    })
    await adoptDeploymentCloudConnections(repository)
    const storedIntegrations = await getStoredIntegrationConfig(settings)
    const authConfig = resolveAuthAdapterConfig(storedIntegrations)
    const smtpConfig = resolveSmtpConfig(storedIntegrations)
    const email = buildEmailDelivery(smtpConfig)
    type WorkspaceRuntime = Awaited<ReturnType<typeof createWorkspaceRuntime>>
    let runtimeRegistry: WorkspaceRuntimeRegistry<WorkspaceRecord, WorkspaceRuntime>

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
          { err: error, event: 'authentication_failed', path: request ? new URL(request.url).pathname : undefined },
          'authentication failed',
        )
      },
    })

    const requireIdentity = async (headers: Headers) => {
      const found = await identity(headers)
      if (!found) throw new Response('unauthenticated', { status: 401 })
      await repository!.ensurePersonalWorkspace(found)
      setRequestIdentity(found)
      return found
    }

    runtimeRegistry = new WorkspaceRuntimeRegistry({
      create: async (workspace) =>
        await createWorkspaceRuntime({
          rootRepository: repository!,
          workspace,
          staging,
          tusUploads,
          telemetry: appTelemetry,
          workLocker: distributedRuntime?.workLocker,
          publisher: realtimePublisher,
          replicaEvents: distributedRuntime?.events,
          invalidate: async () => await runtimeRegistry.invalidate(workspace.id),
        }),
      current: async (runtime) => await storageRuntimeIsCurrent(runtime.repository, runtime.storageRevision),
      revisionTtlMs: 5_000,
    })
    const runtime = async (workspace: WorkspaceRecord) => await runtimeRegistry.get(workspace.id, workspace)
    if (distributedRuntime)
      resetOnRemoteStorageChange(distributedRuntime.events, async (workspaceId) => await runtimeRegistry.invalidate(workspaceId))

    const activeUploadIds = new Set<string>()
    for (const workspace of await repository.listWorkspaces()) {
      const scopedRepository = await repository.scoped(workspace.id)
      for (const uploadId of await scopedRepository.expireUploads(Date.now())) await staging.remove(staging.uploadPart(uploadId))
      for (const uploadId of await scopedRepository.activeUploadIds(Date.now())) activeUploadIds.add(uploadId)
    }
    await localStaging?.sweepUploads(activeUploadIds)
    const { cleanExpiredTusUploads } = await import('./uploads')
    await cleanExpiredTusUploads(uploadDatastore)
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
        logger.warn(
          { err: error, event: 'workspace_asset_layout_cleanup_failed', workspace_id: workspace.id },
          'empty workspace asset layout cleanup failed',
        )
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
      setRequestIdentity(workspaceIdentity)
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
      const { baseIdentity } = await workspaceMembership(headers)
      return await repository!.createWorkspace(baseIdentity, name, {}, hostedDeployment() ? HOSTED_OWNED_WORKSPACE_LIMIT : undefined)
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
      if (storage.adapter === 'managed') await repository!.queueManagedStorageDeletion(membership.id)
      await runtimeRegistry.invalidate(membership.id)
      await auth.api.deleteOrganization({ body: { organizationId: membership.id }, headers })
      if (storage.adapter === 'managed') await processManagedStorageDeletionQueue(repository!, membership.id)
      if (wasPersonal && ownerReplacement) await repository!.setPersonalWorkspace(baseIdentity.id, ownerReplacement.id)
      await auth.api.setActiveOrganization({ body: { organizationId: nextWorkspace.id }, headers })
      if (storage.adapter === 'local' && storageNamespaced) {
        try {
          await fs.promises.rm(storage.root, { recursive: true, force: true })
        } catch (error) {
          logger.warn(
            { err: error, event: 'workspace_storage_cleanup_failed', workspace_id: membership.id },
            'deleted workspace but could not remove local files',
          )
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
      logger.info({ event: 'application_stopping', active_workspaces: runtimeRegistry.size }, 'application stopping')
      try {
        await runtimeRegistry.close()
      } finally {
        try {
          await appTelemetry.shutdown()
        } finally {
          setTelemetryExporters(undefined)
          await repository?.close()
          await distributedRuntime?.close()
          lease?.release()
        }
      }
    }

    logger.info(
      {
        event: 'application_started',
        workspace_count: (await repository.listWorkspaces()).length,
        password_auth: authConfig.password,
        social_provider_count: authConfig.socialProviders.length,
        telemetry_enabled: telemetryConfig.enabled,
      },
      'application started',
    )

    return {
      repository,
      staging,
      uploadDatastore,
      uploadLocker,
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
      await distributedRuntime?.close()
      lease?.release()
    }
    throw error
  }
}

type WorkspaceRuntimeOptions = {
  rootRepository: DrizzleRepository
  workspace: WorkspaceRecord
  staging: UploadStagingArea
  tusUploads: UploadStore
  telemetry: OptionalPostHogTelemetry
  invalidate: () => Promise<void>
  workLocker?: WorkLocker
  publisher?: RealtimePublisher
  replicaEvents?: import('../adapters/replicaEvents').ReplicaStorageEvents
}

export async function createWorkspaceRuntime(options: WorkspaceRuntimeOptions) {
  const { rootRepository, workspace, staging, tusUploads, telemetry, invalidate, workLocker, replicaEvents } = options
  const repository = await rootRepository.scoped(workspace.id)
  const storageRevision = await repository.getSetting<string>(STORAGE_RUNTIME_REVISION_SETTING)
  const storage = await resolveStorageConfig(repository)
  const legacyCloudCleanup = await repository.getSetting<LegacyCloudStorageCleanup>(LEGACY_CLOUD_STORAGE_CLEANUP_SETTING)
  if (legacyCloudCleanup) {
    try {
      const legacy = await buildAssetStore(legacyCloudCleanup.source, repository, workspace.id, workLocker)
      await legacy.clear({ initialize: false })
      await repository.deleteSetting(LEGACY_CLOUD_STORAGE_CLEANUP_SETTING)
    } catch (error) {
      logger.warn(
        { err: error, event: 'legacy_cloud_storage_cleanup_pending', workspace_id: workspace.id },
        'legacy cloud storage cleanup will retry on startup',
      )
    }
  }
  // A marker left over from a cleanup that never completed must not fire once managed storage is
  // active again — the pending clear would delete the objects the workspace is now serving.
  if (storage.adapter !== 'managed' && (await repository.getSetting(MANAGED_STORAGE_CLEANUP_SETTING)) !== undefined) {
    try {
      const managed = buildManagedAssetStore(workspace.id, repository, workLocker)
      await managed.initialize()
      await completeManagedStorageCleanup(repository, managed)
    } catch (error) {
      logger.warn(
        { err: error, event: 'managed_storage_cleanup_pending', workspace_id: workspace.id },
        'managed storage cleanup will retry on startup',
      )
    }
  }
  const assets = await buildAssetStore(storage, repository, workspace.id, workLocker)
  const uploadStaging = assets instanceof QuotaAssetStore ? new QuotaUploadStaging(staging, assets) : staging
  const realtime = realtimeConfig()
  const publisher = options.publisher ?? new RealtimePublisher(realtime.apiUrl, realtime.apiKey)
  const events = new RealtimeEventBus(publisher, workspace.id, replicaEvents)
  let assertAssetsMutable: () => Promise<void> = async () => undefined
  const workspaceTelemetry = withTelemetryContext(telemetry, { workspace_id: workspace.id })
  const service = new STLQuestService(repository, assets, uploadStaging, events, workspaceTelemetry, tusUploads, () =>
    assertAssetsMutable(),
  )
  let storageReady = false
  let storageRecovery: Promise<boolean> | undefined
  let assetQueue: AssetGenerationQueue
  const recoverStorage = () => {
    if (storageRecovery) return storageRecovery
    // The failure handling lives OUTSIDE the lease so that a failed lease acquisition (e.g. a
    // contended recovery lease that never becomes available) degrades to the not-ready state like
    // any other recovery failure. The finally clears the memo unconditionally, so a rejected
    // acquisition can be retried instead of replaying a permanently-rejected promise.
    storageRecovery = (async () => {
      try {
        await withWorkLease(
          workLocker,
          `recovery:${workspace.id}`,
          async () => {
            await assets.initialize()
            await assets.writable()
            await service.recoverOperations()
            const migration = await repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING)
            if (migration?.state !== 'running') await runAssetMigrations(repository, assets)
            try {
              await assets.sweepTrash()
            } catch (error) {
              logger.warn({ err: error, workspaceId: workspace.id }, 'workspace storage trash cleanup failed')
            }
            storageReady = true
            await assetQueue?.backfill()
          },
          RECOVERY_LEASE_OPTIONS,
        )
        return true
      } catch (error) {
        storageReady = false
        logger.warn({ err: error, event: 'workspace_storage_not_ready', workspace_id: workspace.id }, 'workspace storage is not ready')
        return false
      }
    })().finally(() => {
      storageRecovery = undefined
    })
    return storageRecovery
  }
  await recoverStorage()
  await repository.reconcileWorkflow()
  const assetQueueLimits = resolveAssetQueueLimits()
  assetQueue = new AssetGenerationQueue(repository, assets, events, telemetry, {
    concurrency: assetQueueLimits.concurrency,
    sourceByteBudget: assetQueueLimits.sourceByteBudget,
    workLocker,
    currentStorage: async () =>
      (await repository.getSetting<string>(STORAGE_RUNTIME_REVISION_SETTING)) === storageRevision &&
      (await repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING))?.state !== 'running',
  })
  const storageMigration = new StorageMigrationCoordinator({
    repository,
    source: assets,
    sourceConfig: storage,
    queue: assetQueue,
    buildStore: (config) => buildAssetStore(config, repository, workspace.id, workLocker),
    activate: async () => {
      events.publish('storage.changed')
      await invalidate()
    },
    telemetry,
    clearDestination: async (config) => {
      const destination = await buildAssetStore(config, repository, workspace.id, workLocker)
      await destination.clear({ initialize: false })
    },
    distributed: workLocker ? { workLocker, lockId: workspace.id } : undefined,
  })
  assertAssetsMutable = async () => {
    if (!(await storageRuntimeIsCurrent(repository, storageRevision))) {
      throw new Response('workspace storage changed; retry the request', { status: 503 })
    }
    await storageMigration.assertAssetsMutable()
  }
  if (storageReady && !(await storageMigration.active())) await assetQueue.backfill()
  if (storageReady) {
    const migration = await storageMigration.status()
    const migrationIdle = !migration || migration.state === 'completed' || migration.state === 'cancelled'
    if (workspace.id === 'legacy-workspace' && !(await repository.getSetting(LEGACY_STORAGE_NAMESPACE_SETTING)) && !migration) {
      await storageMigration.startLegacyNamespace(namespacedStorageConfig(storage, workspace.id))
    } else if (migrationIdle) {
      const canonicalCloud = canonicalCloudStorageConfig(storage)
      if (canonicalCloud) await storageMigration.startCanonicalCloudRoot(canonicalCloud)
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
    storageRevision,
    get storageReady() {
      return storageReady
    },
    recoverStorage,
    refreshDiagnostics,
    close: async () => {
      if (closed) return
      closed = true
      await assetQueue.shutdown()
    },
  }
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, operation: (item: T) => Promise<R>) {
  const results: R[] = []
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next++
        results[index] = await operation(items[index])
      }
    }),
  )
  return results
}

export function app() {
  const existing = peekGlobalSingleton('stlquest.app') as ReturnType<typeof createApp> | undefined
  const running = globalAsyncSingleton('stlquest.app', createApp)
  const lifecycle = appLifecycle()
  if (existing) {
    if (lifecycle.workflowVersion === workflowVersion) return running
    const reconciliation =
      lifecycle.reconciliation ??
      running.then(async (instance) => {
        for (const workspace of await instance.repository.listWorkspaces())
          await (await instance.repository.scoped(workspace.id)).reconcileWorkflow()
        lifecycle.workflowVersion = workflowVersion
      })
    lifecycle.reconciliation = reconciliation
    const clearReconciliation = () => {
      if (lifecycle.reconciliation === reconciliation) delete lifecycle.reconciliation
    }
    void reconciliation.then(clearReconciliation, clearReconciliation)
    return Promise.all([running, reconciliation]).then(([instance]) => instance)
  }
  void running.then(
    () => {
      lifecycle.workflowVersion = workflowVersion
    },
    () => undefined,
  )
  return running
}

export async function resetApp() {
  const running = peekGlobalSingleton('stlquest.app') as ReturnType<typeof createApp> | undefined
  await clearGlobalSingleton('stlquest.app')
  await clearGlobalSingleton('stlquest.lifecycle')
  const instance = running ? await running.catch(() => undefined) : undefined
  await instance?.close()
  logger.info({ event: 'application_singleton_reset' }, 'application singleton reset')
}

export function resetOnRemoteStorageChange(
  events: Pick<import('../adapters/replicaEvents').ReplicaStorageEvents, 'onRemoteChange'>,
  invalidate: (workspaceId: string) => Promise<void>,
) {
  return events.onRemoteChange(invalidate)
}

export async function storageRuntimeIsCurrent(
  repository: Pick<import('../core/types').Repository, 'getSetting'>,
  revision: string | undefined,
) {
  return (await repository.getSetting<string>(STORAGE_RUNTIME_REVISION_SETTING)) === revision
}

export async function localActiveUploads(
  uploadIds: Set<string>,
  distributedPreviouslyEnabled: boolean,
  datastore: Pick<import('@tus/server').DataStore, 'getUpload'>,
) {
  if (!distributedPreviouslyEnabled) return uploadIds.size > 0
  for (const uploadId of uploadIds) {
    try {
      if (!(await datastore.getUpload(uploadId))) return true
    } catch (error) {
      if (!isMissingObject(error)) throw error
      return true
    }
  }
  return false
}

export async function shutdownApp() {
  const running = peekGlobalSingleton('stlquest.app') as ReturnType<typeof createApp> | undefined
  await clearGlobalSingleton('stlquest.app')
  await clearGlobalSingleton('stlquest.lifecycle')
  const instance = running ? await running.catch(() => undefined) : undefined
  await instance?.close()
}

if (process.env.NODE_ENV !== 'test')
  globalSingleton('stlquest.signals', () => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => {
        void shutdownApp().finally(() => process.exit(0))
      })
    }
    return true
  })
