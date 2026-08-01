import crypto from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { errorMessage } from '../core/error'
import { inviteIsActive } from '../core/invites'
import { createServerFn } from '@tanstack/react-start'
import { getRequest as getRawRequest, setCookie } from '@tanstack/react-start/server'
import { resolveAuthAdapterConfig } from '../adapters/auth'
import { buildEmailDelivery, resolveSmtpConfig } from '../adapters/email'
import { app, deploymentSettings, hashInviteToken, resetApp, resolveBoardConfig, resolveStorageConfig, resolveTelemetryConfig } from './app'
import { managedStorageAvailable } from './managedStorage'
import { storagePlans } from '../core/plans'
import { billingAvailable } from './billing'
import { workflow } from '../core/workflow'
import { cloudStorageProviderName, SOCIAL_AUTH_PROVIDERS, type IntegrationConfig } from '../core/auth'
import type { PrinterProfile, Role, StorageMigration, Telemetry } from '../core/types'
import { printerProfileChanges, PRINTERS_SETTING, storedPrinterProfiles } from '../core/printers'
import {
  encryptSetting,
  getStoredIntegrationConfig,
  publicIntegrationConfig,
  setStoredIntegrationConfig,
  socialProviderCredentialsChanged,
} from './integrations'
import { userImage } from './avatar'
import {
  acceptInviteSchema,
  boardSettingsSchema,
  beginProviderInviteSchema,
  changeOwnEmailSchema,
  createInviteSchema,
  createPrintGroupSchema,
  deletePrintGroupSchema,
  deleteRequestsSchema,
  idSchema,
  inviteInfoSchema,
  moveCopiesSchema,
  moveCopiesBatchSchema,
  movePrintGroupSchema,
  movePrintGroupItemSchema,
  renamePrintGroupSchema,
  reorderPrintGroupItemSchema,
  printerProfilesSchema,
  reorderRequestSchema,
  requestFiltersSchema,
  repeatRequestSchema,
  setOwnPasswordSchema,
  passwordAuthSettingsSchema,
  socialProviderEnabledSchema,
  socialProviderSettingsSchema,
  smtpEmailSettingsSchema,
  storageDirectorySchema,
  storageSettingsSchema,
  storageChangeSchema,
  cloudConnectionSchema,
  cloudStorageAppSchema,
  cloudProviderSchema,
  cloudProviderEnabledSchema,
  telemetrySettingsSchema,
  onboardingUpdateSchema,
  unlinkOwnAccountSchema,
  updateRequestSchema,
} from './schemas'
import { beginCloudStorageAuthorization } from './cloudConnections'
import { disconnectCloudStorage, publicCloudConnection } from './cloudConnectionState'
import {
  completeManagedStorageCleanup,
  MANAGED_STORAGE_CLEANUP_SETTING,
  STORAGE_MIGRATION_SETTING,
  STORAGE_RUNTIME_REVISION_SETTING,
} from './storageMigration'
import { systemDiagnostics } from './operations'
import { checkForReleaseUpdate } from './releases'
import { storageDirectories } from './storageDirectories'
import { resolveStorageInput, storageChangeRequiresMigration, storageConfigurationKind, storageLocationChanged } from './storageConfig'
import { publicOrigin } from './sameOrigin'
import {
  buildStorageCandidate,
  emptyStorageInventory,
  inspectStorageCandidate,
  maskStorage,
  maskStorageMigration,
  validateStorageCandidate,
} from './storageInspection'
import { assertStorageAllowed, hostedStorageRequiresRemote, localStorageEnabled, storageConfigured } from './storagePolicy'
import { HOSTED_OWNED_WORKSPACE_LIMIT, hostedDeployment } from './hosted'
import { cloudStorageApp, requireCloudStorageApp, setCloudStorageApp } from './cloudStorage'
import { normalizeAuthHeaders, writeAuthCookies } from './authCookies'
import { mutationRpc, rpc } from './rpc'
import { workspaceMutation } from './workspaceRpc'

const INVITE_TTL = 7 * 24 * 60 * 60 * 1000

export const canViewManagedStorageUsage = (role: Role) => role === 'admin'

const getRequest = getRawRequest
const getRequestHeaders = () => normalizeAuthHeaders(getRawRequest().headers)

const me = async (instance: Awaited<ReturnType<typeof app>>) => instance.requireIdentity(getRequestHeaders())
const superAdmin = async (instance: Awaited<ReturnType<typeof app>>) => {
  const identity = await me(instance)
  if (!identity.superAdmin) throw new Response('forbidden', { status: 403 })
  return identity
}

async function integrationConfig(instance: Awaited<ReturnType<typeof app>>): Promise<IntegrationConfig> {
  return (await getStoredIntegrationConfig(deploymentSettings(instance.repository))) ?? { passwordEnabled: true }
}

async function currentAuthCapabilities(instance: Awaited<ReturnType<typeof app>>) {
  const auth = resolveAuthAdapterConfig(await getStoredIntegrationConfig(deploymentSettings(instance.repository)))
  return {
    password: auth.password,
    passwordReset: auth.password && instance.emailCapabilities.configured,
    socialProviders: auth.socialProviders,
  }
}

function assertSocialProviderMutable(provider: (typeof SOCIAL_AUTH_PROVIDERS)[number]) {
  const prefix = `AUTH_${provider.toUpperCase()}`
  if (process.env[`${prefix}_CLIENT_ID`] || process.env[`${prefix}_CLIENT_SECRET`]) {
    throw new Response(`${provider} is controlled by the deployment environment`, { status: 409 })
  }
}

function assertSmtpMutable() {
  if (process.env.SMTP_HOST) throw new Response('SMTP is controlled by the deployment environment', { status: 409 })
}

async function inviteWorkspace(instance: Awaited<ReturnType<typeof app>>, token: string) {
  const tokenHash = hashInviteToken(token)
  const workspaceSlug = await instance.repository.workspaceSlugForInvite(tokenHash, Date.now())
  if (!workspaceSlug) return undefined
  const workspace = await instance.repository.workspaceBySlug(workspaceSlug)
  if (!workspace) return undefined
  return { tokenHash, workspaceSlug, workspace, context: await instance.publicWorkspace(workspaceSlug) }
}

async function requireValidInvite(instance: Awaited<ReturnType<typeof app>>, token: string) {
  const resolved = await inviteWorkspace(instance, token)
  const invite = resolved && (await resolved.context.repository.findInvite(resolved.tokenHash))
  if (!resolved || !invite || !inviteIsActive(invite, Date.now())) {
    throw new Response('this invite link is no longer valid', { status: 410 })
  }
  return { ...resolved, invite }
}

const workspaceSlugSchema = z.string().trim().min(1).max(100)
const workspaceInputSchema = z.object({ workspaceSlug: workspaceSlugSchema })
const routeErrorSchema = z.object({
  name: z.string().max(100),
  message: z.string().max(2_000),
  stack: z.string().max(20_000).optional(),
})
const inWorkspace = <T extends z.ZodType>(schema: T) => z.intersection(schema, workspaceInputSchema)
const workspaceContext = async (instance: Awaited<ReturnType<typeof app>>, workspaceSlug?: string) =>
  instance.workspace(getRequestHeaders(), workspaceSlug)
const workspaceAdmin = async (instance: Awaited<ReturnType<typeof app>>, workspaceSlug?: string) => {
  const context = await workspaceContext(instance, workspaceSlug)
  if (context.identity.role !== 'admin') throw new Response('forbidden', { status: 403 })
  return context
}

export const reportRouteError = createServerFn({ method: 'POST' })
  .validator(routeErrorSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      await captureRouteError(instance.telemetry, data)
    }),
  )

export async function captureRouteError(telemetry: Pick<Telemetry, 'exception'>, data: z.infer<typeof routeErrorSchema>) {
  const error = new Error(data.message)
  error.name = data.name
  if (data.stack) error.stack = data.stack
  await telemetry.exception(error, { action: 'route_error' })
}
export const createWorkspace = createServerFn({ method: 'POST' })
  .validator(z.object({ name: z.string().trim().min(1).max(80) }))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const workspace = await instance.createWorkspace(getRequestHeaders(), data.name)
      await instance.setActiveWorkspace(workspace.id, getRequestHeaders())
      return workspace
    }),
  )

export const deleteWorkspace = createServerFn({ method: 'POST' })
  .validator(z.object({ workspaceSlug: workspaceSlugSchema, confirmation: z.string().max(80) }))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const identity = await me(instance)
      const result = await instance.deleteWorkspace(getRequestHeaders(), data.workspaceSlug, data.confirmation)
      void instance.telemetry.capture(identity.id, 'workspace_deleted', {}).catch(() => undefined)
      return result
    }),
  )

export const switchWorkspace = createServerFn({ method: 'POST' })
  .validator(z.object({ workspaceId: z.string().min(1) }))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      return instance.setActiveWorkspace(data.workspaceId, getRequestHeaders())
    }),
  )

export const sessionInfo = createServerFn({ method: 'GET' })
  .validator(z.object({ workspaceSlug: workspaceSlugSchema.optional() }))
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      const identity = await instance.identity(getRequestHeaders())
      const authenticated = identity ? await instance.requireIdentity(getRequestHeaders()) : undefined
      const workspaces = authenticated ? await instance.listWorkspaces(authenticated.id) : []
      const context = authenticated ? await instance.workspace(getRequestHeaders(), data.workspaceSlug) : undefined
      const printers = context ? await storedPrinterProfiles(context.repository) : []
      const printersConfigured = context ? (await context.repository.getSetting<PrinterProfile[]>(PRINTERS_SETTING)) !== undefined : false
      const workspaceOwnerId = context ? await context.repository.workspaceOwnerId() : undefined
      const managedStorageEligible =
        context && workspaceOwnerId
          ? await context.repository.managedStorageEligible(workspaceOwnerId, HOSTED_OWNED_WORKSPACE_LIMIT)
          : false
      const managedStoragePlan = authenticated ? await instance.repository.managedStoragePlan(authenticated.id) : 'free'
      // Uploads are enforced against the entitlement owner's plan, so usage must be measured
      // against the same allowance rather than the signed-in user's own subscription.
      const managedStorageOwnerId = context ? await context.repository.managedStorageOwnerId() : undefined
      const workspaceStoragePlan = context ? await context.repository.managedStoragePlan() : 'free'
      const managedStorageQuotaBytes = storagePlans[workspaceStoragePlan].quotaBytes
      const managedStorageAvailableBytes =
        context?.storage.adapter === 'managed' && canViewManagedStorageUsage(context.identity.role)
          ? await context.repository.managedStorageRemaining(managedStorageQuotaBytes)
          : undefined
      /**
       * The signed-in account's own allowance, which is a different fact to the one governing the
       * workspace being viewed: an admin can be looking at a workspace entitled to someone else.
       * Reported whenever any workspace they own is on included storage, so the figure follows the
       * account rather than the page, and omitted entirely when none of them are.
       */
      const ownManagedStorage =
        authenticated && managedStorageAvailable() && (await instance.repository.managedStorageEntitlementCount(authenticated.id)) > 0
          ? {
              quotaBytes: storagePlans[managedStoragePlan].quotaBytes,
              availableBytes: await instance.repository.managedStorageRemaining(
                storagePlans[managedStoragePlan].quotaBytes,
                authenticated.id,
              ),
            }
          : undefined
      return {
        identity: context?.identity ?? identity,
        serverVersion: __APP_VERSION__,
        workspaces,
        workspace: context?.workspace,
        setupRequired: (await instance.repository.countUsers()) === 0,
        storageConfigured: context ? await storageConfigured(context.repository) : false,
        storageReady: context ? context.storageReady && !hostedStorageRequiresRemote(context.storage) : false,
        localStorageAllowed: localStorageEnabled(),
        managedStorageAvailable: managedStorageAvailable(),
        managedStorageEligible,
        managedStorageAccount: ownManagedStorage,
        managedStorageUsage:
          managedStorageAvailableBytes === undefined
            ? undefined
            : {
                usedOrReservedBytes: managedStorageQuotaBytes - managedStorageAvailableBytes,
                availableBytes: managedStorageAvailableBytes,
                quotaBytes: managedStorageQuotaBytes,
              },
        billing: authenticated
          ? {
              available: billingAvailable(),
              plan: managedStoragePlan,
              plans: storagePlans,
              workspacePlan: workspaceStoragePlan,
              // Only the entitlement owner's subscription can raise this workspace's allowance.
              canUpgrade: billingAvailable() && managedStorageOwnerId === authenticated.id,
            }
          : undefined,
        managedStorageUnavailableReason:
          managedStorageAvailable() && !managedStorageEligible
            ? `Your included storage is already used by ${HOSTED_OWNED_WORKSPACE_LIMIT} workspaces you own.`
            : undefined,
        canCreateWorkspace:
          !authenticated ||
          !hostedDeployment() ||
          (await instance.repository.countOwnedWorkspaces(authenticated.id)) < HOSTED_OWNED_WORKSPACE_LIMIT,
        printersConfigured,
        printers,
        telemetryEnabled: (await resolveTelemetryConfig(deploymentSettings(instance.repository))).enabled,
        privateRequests: context ? (await resolveBoardConfig(context.repository)).privateRequests : false,
        auth: await currentAuthCapabilities(instance),
        hosted: hostedDeployment(),
        email: instance.emailCapabilities,
        workflow,
      }
    }),
  )

export const getPrinters = createServerFn({ method: 'GET' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      return { profiles: await storedPrinterProfiles(context.repository) }
    }),
  )

export const savePrinterProfiles = createServerFn({ method: 'POST' })
  .validator(inWorkspace(printerProfilesSchema))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const previous = await storedPrinterProfiles(context.repository)
      await context.repository.replacePrinterProfiles(data.profiles)
      context.events.publish('settings.changed')
      void instance.telemetry
        .capture(context.identity.id, 'printer_saved', {
          printer_count: data.profiles.length,
          ...printerProfileChanges(previous, data.profiles),
        })
        .catch(() => undefined)
      return { saved: true }
    }),
  )

/**
 * Everything the plan page shows about the signed-in account's subscription. Stripe syncs the
 * renewal and cancellation fields through Better Auth, so this needs no Stripe call.
 */
export const getPlanOverview = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    const identity = await me(instance)
    const plan = await instance.repository.managedStoragePlan(identity.id)
    const [subscription, workspaces] = await Promise.all([
      instance.repository.managedStorageSubscription(identity.id),
      instance.repository.managedStorageWorkspaceUsage(identity.id),
    ])
    return {
      available: billingAvailable(),
      plan,
      plans: storagePlans,
      quotaBytes: storagePlans[plan].quotaBytes,
      subscription: subscription
        ? {
            status: subscription.status,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            billingInterval: subscription.billingInterval,
            periodEnd: subscription.periodEnd ?? undefined,
            trialEnd: subscription.trialEnd ?? undefined,
            cancelAt: subscription.cancelAt ?? undefined,
          }
        : undefined,
      workspaces,
    }
  }),
)

export const getAccountMethods = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    await me(instance)
    const accounts = await instance.auth.api.listUserAccounts({ headers: getRequestHeaders() })
    return {
      linked: accounts.map((account) => account.providerId),
      availableProviders: instance.authCapabilities.socialProviders,
      passwordAvailable: instance.authCapabilities.password,
    }
  }),
)

export const getAuthCapabilities = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => currentAuthCapabilities(await app())),
)

export const setOwnPassword = createServerFn({ method: 'POST' })
  .validator(setOwnPasswordSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const identity = await me(instance)
      if (!instance.authCapabilities.password) throw new Response('password authentication is disabled', { status: 409 })
      const accounts = await instance.auth.api.listUserAccounts({ headers: getRequestHeaders() })
      if (accounts.some((account) => account.providerId === 'credential')) {
        throw new Response('this account already has a password', { status: 409 })
      }
      await instance.auth.api.setPassword({ body: { newPassword: data.password }, headers: getRequestHeaders() })
      void instance.telemetry.capture(identity.id, 'sign_in_method_added', { provider: 'password' }).catch(() => undefined)
      return { configured: true }
    }),
  )

export const changeOwnEmail = createServerFn({ method: 'POST' })
  .validator(changeOwnEmailSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const identity = await me(instance)
      const accounts = await instance.auth.api.listUserAccounts({ headers: getRequestHeaders() })
      if (!accounts.some((account) => account.providerId === 'credential')) {
        throw new Response('create a password before changing your email address', { status: 409 })
      }
      await instance.auth.manageAccount.changeEmail({
        headers: getRequestHeaders(),
        newEmail: data.email,
        password: data.password,
      })
      void instance.telemetry.capture(identity.id, 'account_email_change_requested').catch(() => undefined)
      return { requested: true }
    }),
  )

export const unlinkOwnAccount = createServerFn({ method: 'POST' })
  .validator(unlinkOwnAccountSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const identity = await me(instance)
      await instance.auth.manageAccount.unlinkAccount({ headers: getRequestHeaders(), providerId: data.provider })
      void instance.telemetry.capture(identity.id, 'sign_in_method_removed', { provider: data.provider }).catch(() => undefined)
      return { removed: true }
    }),
  )

export const getIntegrationSettings = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    await superAdmin(instance)
    const stored = await getStoredIntegrationConfig(deploymentSettings(instance.repository))
    const origin = publicOrigin(getRequest())
    const settings = publicIntegrationConfig(stored, resolveAuthAdapterConfig(stored), resolveSmtpConfig(stored), origin)
    const accounts = await instance.auth.api.listUserAccounts({ headers: getRequestHeaders() })
    for (const provider of SOCIAL_AUTH_PROVIDERS) {
      settings.providers[provider].linked = accounts.some((account) => account.providerId === provider)
    }
    return { ...settings }
  }),
)

export const updatePasswordAuth = createServerFn({ method: 'POST' })
  .validator(passwordAuthSettingsSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const identity = await superAdmin(instance)
      if (process.env.AUTH_PASSWORD_ENABLED !== undefined || process.env.AUTH_PASSWORD_RECOVERY !== undefined) {
        throw new Response('password authentication is controlled by the deployment environment', { status: 409 })
      }
      const config = await integrationConfig(instance)
      if (!data.enabled) {
        const enabledProviders = instance.authCapabilities.socialProviders
        if (enabledProviders.length === 0)
          throw new Response('enable and test a social provider before disabling passwords', { status: 409 })
        const accounts = await instance.auth.api.listUserAccounts({ headers: getRequestHeaders() })
        if (!enabledProviders.some((provider) => accounts.some((account) => account.providerId === provider))) {
          throw new Response('link the current admin account to an enabled social provider before disabling passwords', { status: 409 })
        }
      }
      await setStoredIntegrationConfig(deploymentSettings(instance.repository), { ...config, passwordEnabled: data.enabled })
      void instance.telemetry
        .capture(identity.id, 'auth_provider_configured', { provider: 'password', enabled: data.enabled })
        .catch(() => undefined)
      await resetApp()
      return { enabled: data.enabled }
    }),
  )

export const saveSocialProvider = createServerFn({ method: 'POST' })
  .validator(socialProviderSettingsSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      await superAdmin(instance)
      assertSocialProviderMutable(data.provider)
      const config = await integrationConfig(instance)
      const current = config[data.provider]
      const anotherEnabled = SOCIAL_AUTH_PROVIDERS.some((candidate) => candidate !== data.provider && config[candidate]?.enabled)
      if (current?.enabled && !instance.authCapabilities.password && !anotherEnabled) {
        throw new Response('enable password authentication before changing the only active social provider', { status: 409 })
      }
      const clientSecret = data.clientSecret || current?.clientSecret
      if (!clientSecret) throw new Response('client secret is required', { status: 400 })
      if (current && socialProviderCredentialsChanged(current, data.clientId, data.clientSecret)) {
        const accounts = await instance.auth.api.listUserAccounts({ headers: getRequestHeaders() })
        if (accounts.some((account) => account.providerId === data.provider)) {
          await instance.auth.manageAccount.unlinkAccount({ headers: getRequestHeaders(), providerId: data.provider })
        }
      }
      await setStoredIntegrationConfig(deploymentSettings(instance.repository), {
        ...config,
        [data.provider]: { enabled: false, clientId: data.clientId, clientSecret },
      })
      await resetApp()
      return { provider: data.provider, configured: true, enabled: false }
    }),
  )

export const updateSocialProviderEnabled = createServerFn({ method: 'POST' })
  .validator(socialProviderEnabledSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const identity = await superAdmin(instance)
      assertSocialProviderMutable(data.provider)
      const config = await integrationConfig(instance)
      const provider = config[data.provider]
      if (!provider) throw new Response(`${data.provider} is not configured`, { status: 400 })
      if (data.enabled) {
        const accounts = await instance.auth.api.listUserAccounts({ headers: getRequestHeaders() })
        if (!accounts.some((account) => account.providerId === data.provider)) {
          throw new Response(`test ${data.provider} by linking the current admin account before enabling it`, { status: 409 })
        }
      } else if (!instance.authCapabilities.password) {
        const remaining = SOCIAL_AUTH_PROVIDERS.some((candidate) => candidate !== data.provider && config[candidate]?.enabled)
        if (!remaining) throw new Response('cannot disable the last active authentication method', { status: 409 })
      }
      await setStoredIntegrationConfig(deploymentSettings(instance.repository), {
        ...config,
        [data.provider]: { ...provider, enabled: data.enabled },
      })
      void instance.telemetry
        .capture(identity.id, 'auth_provider_configured', { provider: data.provider, enabled: data.enabled })
        .catch(() => undefined)
      await resetApp()
      return { provider: data.provider, enabled: data.enabled }
    }),
  )

export const saveSmtpSettings = createServerFn({ method: 'POST' })
  .validator(smtpEmailSettingsSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const identity = await superAdmin(instance)
      assertSmtpMutable()
      const config = await integrationConfig(instance)
      const current = resolveSmtpConfig(config, {})
      const smtp = { ...data, password: data.password || current?.password, testedAt: Date.now() }
      const delivery = buildEmailDelivery(smtp)!
      try {
        await delivery.verify()
        await delivery.send({
          to: identity.email,
          subject: 'STL Quest email is configured',
          text: 'Your STL Quest SMTP connection is configured and working.',
          html: '<p>Your STL Quest SMTP connection is configured and working.</p>',
        })
      } catch (error) {
        throw new Response(`SMTP verification failed: ${errorMessage(error, 'unknown error')}`, { status: 400 })
      }
      await setStoredIntegrationConfig(deploymentSettings(instance.repository), {
        ...config,
        smtp,
      })
      void instance.telemetry.capture(identity.id, 'auth_provider_configured', { provider: 'smtp', enabled: true }).catch(() => undefined)
      await resetApp()
      return { configured: true }
    }),
  )

export const removeSmtpSettings = createServerFn({ method: 'POST' }).handler(async () =>
  mutationRpc(async () => {
    const instance = await app()
    await superAdmin(instance)
    assertSmtpMutable()
    const config = await integrationConfig(instance)
    await setStoredIntegrationConfig(deploymentSettings(instance.repository), {
      ...config,
      smtp: undefined,
    })
    await resetApp()
    return { configured: false }
  }),
)

export const listRequests = createServerFn({ method: 'GET' })
  .validator(inWorkspace(requestFiltersSchema))
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      const { workspaceSlug, ...filters } = data
      const context = await workspaceContext(instance, workspaceSlug)
      const result = await context.service.listRequests(
        context.identity,
        (await resolveBoardConfig(context.repository)).privateRequests,
        filters,
      )
      const images = new Map((await context.repository.listUsers()).map((account) => [account.id, userImage(account.email, account.image)]))
      return {
        ...result,
        requests: result.requests.map((request) => ({ ...request, requesterImage: images.get(request.requesterId) })),
      }
    }),
  )

export const listPeople = createServerFn({ method: 'GET' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      const context = await workspaceContext(instance, data.workspaceSlug)
      // With private requests, requesters see no one else — not even names.
      if (context.identity.role !== 'admin' && (await resolveBoardConfig(context.repository)).privateRequests) {
        return (await context.service.listPeople()).filter((person) => person.id === context.identity.id)
      }
      return context.service.listPeople()
    }),
  )

export const listUsers = createServerFn({ method: 'GET' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      return (await context.repository.listUsers()).map((account) => ({ ...account, image: userImage(account.email, account.image) }))
    }),
  )

export const listAccounts = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    await superAdmin(instance)
    return (await instance.repository.listAccounts()).map((account) => ({ ...account, image: userImage(account.email, account.image) }))
  }),
)

export const updateWorkspaceMemberRole = createServerFn({ method: 'POST' })
  .validator(z.object({ workspaceSlug: workspaceSlugSchema, userId: z.string().min(1), role: z.enum(['admin', 'member']) }))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      await context.repository.setWorkspaceMemberRole(data.userId, data.role)
      context.events.publish('user.created')
      void instance.telemetry.capture(context.identity.id, 'workspace_member_role_changed', { role: data.role }).catch(() => undefined)
    }),
  )

export const removeWorkspaceMember = createServerFn({ method: 'POST' })
  .validator(z.object({ workspaceSlug: workspaceSlugSchema, userId: z.string().min(1) }))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      if (context.identity.id === data.userId) throw new Response('you cannot remove yourself', { status: 409 })
      await context.repository.removeWorkspaceMember(data.userId)
      context.events.publish('user.created')
      void instance.telemetry.capture(context.identity.id, 'workspace_member_removed', {}).catch(() => undefined)
    }),
  )

export const createInvite = createServerFn({ method: 'POST' })
  .validator(inWorkspace(createInviteSchema))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const label = data.label?.trim() ?? ''
      if (data.email && !instance.emailDelivery) throw new Response('configure SMTP before emailing invitations', { status: 409 })
      // The raw token exists only in this response; the database keeps a hash.
      const token = crypto.randomBytes(32).toString('base64url')
      const id = crypto.randomUUID()
      await context.repository.createInvite({
        id,
        tokenHash: hashInviteToken(token),
        role: data.role,
        label: label || undefined,
        recipientEmail: data.email,
        expiresAt: Date.now() + INVITE_TTL,
      })
      const url = `${new URL(getRequest().url).origin}/invite/${token}`
      if (data.email) {
        try {
          await instance.emailDelivery!.send({
            to: data.email,
            subject: 'You are invited to STL Quest',
            text: `You have been invited to STL Quest. Create your account using this single-use link: ${url}\n\nThis link expires in seven days.`,
            html: `<p>You have been invited to STL Quest.</p><p><a href="${url}">Create your account</a></p><p>This single-use link expires in seven days.</p>`,
          })
        } catch (error) {
          await context.repository.deleteInvite(id)
          throw new Response(`could not send invitation: ${errorMessage(error, 'unknown error')}`, { status: 502 })
        }
      }
      void instance.telemetry
        .capture(context.identity.id, 'invite_created', { role: data.role, emailed: Boolean(data.email) })
        .catch(() => undefined)
      return { token, emailed: Boolean(data.email) }
    }),
  )

export const listInvites = createServerFn({ method: 'GET' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const now = Date.now()
      return (await context.repository.listInvites()).filter((invite) => inviteIsActive(invite, now))
    }),
  )

export const revokeInvite = createServerFn({ method: 'POST' })
  .validator(inWorkspace(idSchema))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const invite = (await context.repository.listInvites()).find((candidate) => candidate.id === data.id)
      await context.repository.deleteInvite(data.id)
      if (invite) {
        void instance.telemetry
          .capture(context.identity.id, 'invite_revoked', { role: invite.role, emailed: Boolean(invite.recipientEmail) })
          .catch(() => undefined)
      }
    }),
  )

// Public: the accept page needs to know whether the link is still good
// before asking anyone to type anything.
export const inviteInfo = createServerFn({ method: 'GET' })
  .validator(inviteInfoSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      const workspaceSlug = await instance.repository.workspaceSlugForInvite(hashInviteToken(data.token), Date.now())
      if (!workspaceSlug) {
        return { valid: false, signedIn: false, joined: false, auth: await currentAuthCapabilities(instance) }
      }
      const workspace = (await instance.repository.workspaceBySlug(workspaceSlug))!
      const context = await instance.publicWorkspace(workspaceSlug)
      const invite = await context.repository.findInvite(hashInviteToken(data.token))
      const identity = await instance.identity(getRequestHeaders())
      const joined = identity ? (await instance.repository.workspaceForUser(identity.id, workspaceSlug)) !== undefined : false
      if (joined) await instance.setActiveWorkspace(workspace.id, getRequestHeaders())
      return {
        valid: !!invite && inviteIsActive(invite, Date.now()),
        signedIn: identity !== undefined,
        joined,
        auth: await currentAuthCapabilities(instance),
      }
    }),
  )

export const beginProviderInvite = createServerFn({ method: 'POST' })
  .validator(beginProviderInviteSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      await requireValidInvite(instance, data.token)
      if (!instance.authCapabilities.socialProviders.includes(data.provider)) {
        throw new Response(`${data.provider} authentication is not enabled`, { status: 400 })
      }
      setCookie('stlquest_invite', data.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: new URL(getRequest().url).protocol === 'https:',
        path: '/api/auth',
        maxAge: 10 * 60,
      })
      return { provider: data.provider }
    }),
  )

export const acceptInvite = createServerFn({ method: 'POST' })
  .validator(acceptInviteSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const { workspace, invite } = await requireValidInvite(instance, data.token)
      if (invite.recipientEmail && invite.recipientEmail !== data.email) {
        throw new Response('this invitation belongs to another email address', { status: 403 })
      }
      if (await instance.repository.accountExists(data.email)) {
        throw new Response('an account with this email already exists — sign in instead', { status: 409 })
      }

      const { withAuthInvite } = await import('./authInvite')
      const created = await withAuthInvite(data.token, () =>
        instance.auth.api.signUpEmail({
          body: { email: data.email, password: data.password, name: data.name },
          headers: getRequestHeaders(),
          returnHeaders: true,
        }),
      )
      writeAuthCookies(created.headers)
      await instance.repository.ensurePersonalWorkspace(created.response.user)
      void instance.telemetry.capture(created.response.user.id, 'invite_accepted', {}).catch(() => undefined)
      return { workspaceId: workspace.id }
    }),
  )

export const acceptWorkspaceInvite = createServerFn({ method: 'POST' })
  .validator(inviteInfoSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const headers = getRequestHeaders()
      const identity = await instance.identity(headers)
      if (!identity) throw new Response('unauthenticated', { status: 401 })
      const resolved = await inviteWorkspace(instance, data.token)
      if (!resolved) throw new Response('this invite link is no longer valid', { status: 410 })
      const { tokenHash, workspace, context } = resolved
      const accepted = await context.repository.acceptInviteForUser(tokenHash, Date.now(), identity)
      if (!accepted) throw new Response('this invite link is no longer valid', { status: 410 })
      await instance.setActiveWorkspace(workspace.id, headers)
      context.events.publish('user.created')
      void instance.telemetry.capture(identity.id, 'invite_accepted', {}).catch(() => undefined)
      return { workspaceId: workspace.id }
    }),
  )

export const getTelemetrySettings = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    await superAdmin(instance)
    return resolveTelemetryConfig(deploymentSettings(instance.repository))
  }),
)

export const getOnboardingProgress = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    const identity = await me(instance)
    return instance.repository.getUserOnboarding(identity.id)
  }),
)

export const updateOnboardingProgress = createServerFn({ method: 'POST' })
  .validator(onboardingUpdateSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const identity = await me(instance)
      const current = await instance.repository.getUserOnboarding(identity.id)
      const completed = new Set(current.completedTasks)
      if (data.operation === 'complete') completed.add(data.task)
      if (data.operation === 'skip') for (const task of data.tasks) completed.add(task)
      const next =
        data.operation === 'restart'
          ? { completedTasks: [] }
          : {
              completedTasks: [...completed],
              snoozedUntil: data.operation === 'snooze' ? Date.now() + 24 * 60 * 60 * 1000 : undefined,
            }
      await instance.repository.saveUserOnboarding(identity.id, next)
      return next
    }),
  )

export const updateTelemetrySettings = createServerFn({ method: 'POST' })
  .validator(telemetrySettingsSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      await superAdmin(instance)
      const config = { enabled: data.enabled }
      await instance.repository.setDeploymentSetting('telemetry', config)
      return config
    }),
  )

export const getBoardSettings = createServerFn({ method: 'GET' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      return resolveBoardConfig((await workspaceAdmin(instance, data.workspaceSlug)).repository)
    }),
  )

export const getDiagnostics = createServerFn({ method: 'GET' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const { storageCapacity } = await context.refreshDiagnostics()
      const visualJobs = await Promise.all(
        (await context.repository.listAssetGenerationJobs()).map(async (job) => {
          const request = await context.repository.getRequest(job.requestId)
          return { ...job, kind: job.stage, name: request?.name ?? 'Deleted model', fileName: request?.fileName }
        }),
      )
      return {
        storage: context.storage.adapter,
        storageReady: context.storageReady && !hostedStorageRequiresRemote(context.storage),
        queue: context.assetQueue.stats(),
        backgroundJobs: visualJobs.sort((first, second) => first.queuedAt - second.queuedAt),
        incompleteUploads: await context.repository.incompleteUploadStats(Date.now()),
        storageCapacity,
      }
    }),
  )

export const getSystemDiagnostics = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    await superAdmin(instance)
    return {
      version: __APP_VERSION__,
      authentication: {
        password: instance.authCapabilities.password,
        socialProviders: instance.authCapabilities.socialProviders,
        smtpConfigured: instance.emailCapabilities.configured,
      },
      ...(await systemDiagnostics(instance.repository)),
    }
  }),
)

export const getReleaseUpdate = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    await superAdmin(instance)
    return { update: await checkForReleaseUpdate(__APP_VERSION__) }
  }),
)

export const updateBoardSettings = createServerFn({ method: 'POST' })
  .validator(inWorkspace(boardSettingsSchema))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const current = await resolveBoardConfig(context.repository)
      const config = {
        privateRequests: data.privateRequests ?? current.privateRequests,
      }
      await context.repository.setSetting('board', config)
      // Boards refetch over SSE so requesters' views update immediately.
      context.events.publish('board.changed')
      void instance.telemetry
        .capture(context.identity.id, 'board_visibility_changed', { private_requests: config.privateRequests })
        .catch(() => undefined)
      return config
    }),
  )

export const getStorageSettings = createServerFn({ method: 'GET' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      return await maskStorage(context.storage)
    }),
  )

export const listStorageDirectories = createServerFn({ method: 'POST' })
  .validator(inWorkspace(storageDirectorySchema))
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      await workspaceAdmin(instance, data.workspaceSlug)
      if (!localStorageEnabled()) throw new Response('local storage is unavailable in this deployment mode', { status: 403 })
      if (!path.isAbsolute(data.path)) throw new Response('folder path must be absolute', { status: 400 })
      const directory = path.resolve(data.path)
      let directories: Awaited<ReturnType<typeof storageDirectories>>
      try {
        directories = await storageDirectories(directory)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        const message = code === 'EACCES' ? 'folder is not readable' : code === 'ENOTDIR' ? 'path is not a folder' : 'folder does not exist'
        throw new Response(message, { status: 400 })
      }
      return { path: directory, directories }
    }),
  )

export const getStorageMigration = createServerFn({ method: 'GET' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      return (await maskStorageMigration(await context.storageMigration.status())) ?? null
    }),
  )

export const testStorageConnection = createServerFn({ method: 'POST' })
  .validator(inWorkspace(storageSettingsSchema))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const config = resolveStorageInput(data, context.storage)
      await assertStorageAllowed(config)
      const locationChanged = storageLocationChanged(context.storage, config)
      const destination = locationChanged ? await buildStorageCandidate(config, context.repository, context.workspace.id) : undefined
      if (destination) await inspectStorageCandidate(destination, true)
      await validateStorageCandidate(config, context.repository, context.workspace.id)
      if (destination) await inspectStorageCandidate(destination)
      return { reachable: true as const }
    }),
  )

export const getCloudConnections = createServerFn({ method: 'GET' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const deployment = deploymentSettings(instance.repository)
      const [dropbox, googleDrive, oneDrive, box] = await Promise.all([
        publicCloudConnection(deployment, context.repository, 'dropbox'),
        publicCloudConnection(deployment, context.repository, 'google-drive'),
        publicCloudConnection(deployment, context.repository, 'onedrive'),
        publicCloudConnection(deployment, context.repository, 'box'),
      ])
      return { dropbox, 'google-drive': googleDrive, onedrive: oneDrive, box }
    }),
  )

export const saveCloudStorageApp = createServerFn({ method: 'POST' })
  .validator(cloudStorageAppSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      await superAdmin(instance)
      const deployment = deploymentSettings(instance.repository)
      const current = await cloudStorageApp(deployment, data.provider)
      const clientSecret = data.clientSecret || current?.clientSecret
      if (!clientSecret) throw new Response(`${cloudStorageProviderName(data.provider)} app secret is required`, { status: 400 })
      await setCloudStorageApp(deployment, data.provider, {
        clientId: data.clientId,
        clientSecret,
        enabled: current?.enabled ?? true,
      })
    }),
  )

export const setCloudStorageProviderEnabled = createServerFn({ method: 'POST' })
  .validator(cloudProviderEnabledSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      await superAdmin(instance)
      const deployment = deploymentSettings(instance.repository)
      const current = await cloudStorageApp(deployment, data.provider)
      if (!current) throw new Response(`${cloudStorageProviderName(data.provider)} is not set up`, { status: 409 })
      await setCloudStorageApp(deployment, data.provider, { ...current, enabled: data.enabled })
    }),
  )

export const removeCloudStorageApp = createServerFn({ method: 'POST' })
  .validator(cloudProviderSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      await superAdmin(instance)
      const repositories = await Promise.all(
        (await instance.repository.listWorkspaces()).map(async (workspace) => await instance.repository.scoped(workspace.id)),
      )
      if (
        (await Promise.all(repositories.map(async (repository) => (await resolveStorageConfig(repository)).adapter))).includes(
          data.provider,
        )
      )
        throw new Response(`move workspaces away from ${cloudStorageProviderName(data.provider)} before removing its app`, { status: 409 })
      await setCloudStorageApp(deploymentSettings(instance.repository), data.provider, undefined)
    }),
  )

export const beginCloudConnection = createServerFn({ method: 'POST' })
  .validator(inWorkspace(cloudConnectionSchema))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const cloudApp = await requireCloudStorageApp(deploymentSettings(instance.repository), data.provider)
      const origin = publicOrigin(getRequest())
      const url = await beginCloudStorageAuthorization(
        data.provider,
        cloudApp,
        context.repository,
        context.identity.id,
        origin,
        data.returnTo,
      )
      return {
        url,
      }
    }),
  )

export const removeCloudConnection = createServerFn({ method: 'POST' })
  .validator(inWorkspace(cloudProviderSchema))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      if (context.storage.adapter === data.provider)
        throw new Response(`move storage away from ${cloudStorageProviderName(data.provider)} before disconnecting it`, { status: 409 })
      if ((await context.repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING))?.state === 'running')
        throw new Response('wait for the storage migration to finish', { status: 409 })
      await disconnectCloudStorage(context.repository, data.provider)
      void instance.telemetry.capture(context.identity.id, 'cloud_storage_disconnected', { provider: data.provider }).catch(() => undefined)
    }),
  )

export const startStorageMigration = createServerFn({ method: 'POST' })
  .validator(inWorkspace(storageChangeSchema))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const config = resolveStorageInput(data, context.storage)
      await assertStorageAllowed(config)
      let claimedManagedStorage = false
      if (config.adapter === 'managed') {
        const ownerId = await context.repository.workspaceOwnerId()
        if (!ownerId) throw new Response('workspace owner not found', { status: 409 })
        claimedManagedStorage = await context.repository.claimManagedStorage(ownerId, HOSTED_OWNED_WORKSPACE_LIMIT)
      }
      let migration: StorageMigration
      try {
        migration = await context.storageMigration.start(config, data.destinationAction === 'clear-all')
      } catch (error) {
        if (claimedManagedStorage) await context.repository.releaseManagedStorage()
        throw error
      }
      void instance.telemetry
        .capture(context.identity.id, 'storage_migration_started', { from: context.storage.adapter, to: config.adapter })
        .catch(() => undefined)
      return (await maskStorageMigration(migration))!
    }),
  )

export const retryStorageMigration = createServerFn({ method: 'POST' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const migration = await context.storageMigration.status()
      if (migration) await assertStorageAllowed(migration.destination)
      const retried = await context.storageMigration.retry()
      void instance.telemetry
        .capture(context.identity.id, 'storage_migration_retried', { adapter: retried.destination.adapter })
        .catch(() => undefined)
      return (await maskStorageMigration(retried))!
    }),
  )

export const cancelStorageMigration = createServerFn({ method: 'POST' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      let instance = await app()
      let context = await workspaceAdmin(instance, data.workspaceSlug)
      if (typeof context.storageMigration.cancel !== 'function') {
        await resetApp()
        instance = await app()
        context = await workspaceAdmin(instance, data.workspaceSlug)
      }
      const cancelled = await context.storageMigration.cancel()
      void instance.telemetry
        .capture(context.identity.id, 'storage_migration_cancelled', {
          adapter: cancelled.destination.adapter,
          files_copied: cancelled.copiedFiles,
        })
        .catch(() => undefined)
      return (await maskStorageMigration(cancelled))!
    }),
  )

export const acknowledgeStorageMigration = createServerFn({ method: 'POST' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      if (['completed', 'cancelled'].includes((await context.storageMigration.status())?.state ?? ''))
        await context.repository.deleteSetting(STORAGE_MIGRATION_SETTING)
    }),
  )

export const updateStorageSettings = createServerFn({ method: 'POST' })
  .validator(inWorkspace(storageChangeSchema))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const alreadyConfigured = await storageConfigured(context.repository)

      const config = resolveStorageInput(data, context.storage)
      await assertStorageAllowed(config)

      return await context.storageMigration.withAssetsLocked(async () => {
        const locationChanged = storageLocationChanged(context.storage, config)
        const destination = await buildStorageCandidate(config, context.repository, context.workspace.id)
        const destinationInventory = locationChanged ? await inspectStorageCandidate(destination, true) : emptyStorageInventory()
        await validateStorageCandidate(config, context.repository, context.workspace.id)
        if (data.destinationAction === 'clear-all' && !locationChanged)
          throw new Response('choose a different storage location before replacing its contents', { status: 400 })
        const storageHasActivity =
          (await context.repository.listRequests()).length > 0 ||
          (await context.repository.listOperations()).length > 0 ||
          (await context.repository.activeUploadIds(Date.now())).size > 0
        const migrationRequired = storageChangeRequiresMigration(context.storage, config, storageHasActivity)
        if (
          !data.destinationAction &&
          (migrationRequired || (locationChanged && (destinationInventory.files > 0 || destinationInventory.folders > 0)))
        ) {
          return { reviewRequired: true as const, migrationRequired, destinationInventory }
        }
        if (data.destinationAction === 'clear-all')
          throw new Response('replace destination contents through a storage migration', { status: 409 })

        let claimedManagedStorage = false
        if (config.adapter === 'managed') {
          const ownerId = await context.repository.workspaceOwnerId()
          if (!ownerId) throw new Response('workspace owner not found', { status: 409 })
          claimedManagedStorage = await context.repository.claimManagedStorage(ownerId, HOSTED_OWNED_WORKSPACE_LIMIT)
        }
        try {
          if (context.storage.adapter === 'managed' && config.adapter !== 'managed') {
            await context.repository.setSettings(
              {
                storageEncrypted: encryptSetting(config),
                [MANAGED_STORAGE_CLEANUP_SETTING]: { purpose: 'release' },
                [STORAGE_RUNTIME_REVISION_SETTING]: crypto.randomUUID(),
              },
              ['storage'],
            )
            try {
              await completeManagedStorageCleanup(context.repository, context.assets)
            } catch {
              // The destination is active; startup retries cleanup while the entitlement remains held.
            }
          } else {
            await context.repository.setSettings(
              { storageEncrypted: encryptSetting(config), [STORAGE_RUNTIME_REVISION_SETTING]: crypto.randomUUID() },
              ['storage'],
            )
            // Re-activating managed storage retires any cleanup a previous switch away left pending.
            if (config.adapter === 'managed') await context.repository.deleteSetting(MANAGED_STORAGE_CLEANUP_SETTING)
          }
        } catch (error) {
          if (claimedManagedStorage) await context.repository.releaseManagedStorage()
          throw error
        }
        void instance.telemetry
          .capture(context.identity.id, 'storage_configured', {
            previous_adapter: alreadyConfigured ? context.storage.adapter : undefined,
            adapter: config.adapter,
            configuration_kind: storageConfigurationKind(alreadyConfigured, context.storage, config),
          })
          .catch(() => undefined)
        const storage = await maskStorage(config)
        // Publish before reset so current streams refetch and reconnect to the replacement bus.
        context.events.publish('storage.changed')
        await resetApp()
        return { reviewRequired: false as const, migrationRequired: false as const, storage }
      })
    }),
  )

export const moveCopies = createServerFn({ method: 'POST' })
  .validator(inWorkspace(moveCopiesSchema))
  .handler(async ({ data }) => {
    const { workspaceSlug, ...input } = data
    return workspaceMutation(workspaceSlug, (context) => context.service.moveCopies(input, context.identity))
  })

export const moveCopiesBatch = createServerFn({ method: 'POST' })
  .validator(inWorkspace(moveCopiesBatchSchema))
  .handler(async ({ data }) =>
    workspaceMutation(data.workspaceSlug, (context) => context.service.moveCopiesBatch(data.moves, context.identity)),
  )

export const createPrintGroup = createServerFn({ method: 'POST' })
  .validator(inWorkspace(createPrintGroupSchema))
  .handler(async ({ data }) => {
    const { workspaceSlug, ...input } = data
    return workspaceMutation(workspaceSlug, (context) => context.service.createGroup(input, context.identity))
  })

export const movePrintGroup = createServerFn({ method: 'POST' })
  .validator(inWorkspace(movePrintGroupSchema))
  .handler(async ({ data }) =>
    workspaceMutation(data.workspaceSlug, (context) => context.service.moveGroup(data.id, data.to, context.identity)),
  )

export const movePrintGroupItem = createServerFn({ method: 'POST' })
  .validator(inWorkspace(movePrintGroupItemSchema))
  .handler(async ({ data }) => {
    const { workspaceSlug, ...input } = data
    return workspaceMutation(workspaceSlug, (context) => context.service.moveGroupItem(input, context.identity))
  })

export const renamePrintGroup = createServerFn({ method: 'POST' })
  .validator(inWorkspace(renamePrintGroupSchema))
  .handler(async ({ data }) =>
    workspaceMutation(data.workspaceSlug, (context) => context.service.renameGroup(data.id, data.name, context.identity)),
  )

export const deletePrintGroup = createServerFn({ method: 'POST' })
  .validator(inWorkspace(deletePrintGroupSchema))
  .handler(async ({ data }) => workspaceMutation(data.workspaceSlug, (context) => context.service.deleteGroup(data.id, context.identity)))

export const reorderPrintGroupItem = createServerFn({ method: 'POST' })
  .validator(inWorkspace(reorderPrintGroupItemSchema))
  .handler(async ({ data }) =>
    workspaceMutation(data.workspaceSlug, (context) =>
      context.service.reorderGroupItem(data.groupId, data.requestId, data.targetRequestId, data.edge, context.identity),
    ),
  )

export const reorderRequest = createServerFn({ method: 'POST' })
  .validator(inWorkspace(reorderRequestSchema))
  .handler(async ({ data }) =>
    workspaceMutation(data.workspaceSlug, (context) => context.service.reorder(data.id, data.status, data.order, context.identity)),
  )

export const updateRequest = createServerFn({ method: 'POST' })
  .validator(inWorkspace(updateRequestSchema))
  .handler(async ({ data }) => {
    const { id, workspaceSlug, ...fields } = data
    return workspaceMutation(workspaceSlug, (context) => context.service.update(id, fields, context.identity))
  })

export const repeatRequest = createServerFn({ method: 'POST' })
  .validator(inWorkspace(repeatRequestSchema))
  .handler(async ({ data }) =>
    workspaceMutation(data.workspaceSlug, async (context) => {
      const requestId = await context.service.repeatRequest(data.id, data.quantity, context.identity)
      await context.assetQueue.enqueue(requestId)
      return requestId
    }),
  )

export const deleteRequest = createServerFn({ method: 'POST' })
  .validator(inWorkspace(idSchema))
  .handler(async ({ data }) => workspaceMutation(data.workspaceSlug, (context) => context.service.remove(data.id, context.identity)))

export const deleteRequests = createServerFn({ method: 'POST' })
  .validator(inWorkspace(deleteRequestsSchema))
  .handler(async ({ data }) =>
    workspaceMutation(data.workspaceSlug, (context) => context.service.removeCopiesBatch(data.deletions, context.identity)),
  )
