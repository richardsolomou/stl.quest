import crypto from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { errorMessage } from '../core/error'
import { imageContentType } from '../core/coverImage'
import { sourceCoverChange } from '../core/request'
import { inviteIsActive } from '../core/invites'
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setCookie } from '@tanstack/react-start/server'
import { resolveAuthAdapterConfig } from '../adapters/auth'
import {
  brandedEmailParts,
  buildEmailDelivery,
  resolveSmtpConfig,
  workspaceEmailDelivery,
  type EmailDelivery,
  type EmailMessage,
} from '../adapters/email'
import {
  EMAIL_LOGO_SETTING,
  EMAIL_SENDER_SETTING,
  EMAIL_TEMPLATES_SETTING,
  HOSTED_SMTP_PORTS,
  hostedSmtpPortAllowed,
  isEmailLogoType,
  MAX_EMAIL_LOGO_BYTES,
  WORKSPACE_SMTP_SETTING,
  type EmailLogo,
  type EmailSender,
  type EmailTemplate,
  type EmailTemplateKind,
  type EmailTemplates,
} from '../core/email'
import { mailServerTestEmail } from '../core/notifications'
import {
  app,
  deploymentSettings,
  hashToken,
  memberSeesOnlyOwnRequests,
  resetApp,
  resolveBoardConfig,
  resolveSelfSignupConfig,
  resolveStorageConfig,
  resolveTelemetryConfig,
  SELF_SIGNUP_SETTING,
} from './app'
import { managedStorageAvailable } from './managedStorage'
import { storagePlans } from '../core/plans'
import { billingAvailable } from './billing'
import { workflow } from '../core/workflow'
import { activeItems } from '../core/inventory'
import { DEFAULT_PRICE_CALCULATOR_SETTINGS, PRICE_CALCULATOR_SETTING } from '../core/priceCalculator'
import {
  cloudStorageProviderName,
  oidcDisplayName,
  parseOidcScopes,
  SOCIAL_AUTH_PROVIDERS,
  type SmtpEmailConfig,
  type SignInCapabilities,
  socialProviderCredentialsChanged,
  socialProviderNeedsRetest,
} from '../core/auth'
import type { BoardConfig, Repository, Role, StorageMigration, Telemetry } from '../core/types'
import { PRINTERS_SKIPPED_SETTING } from '../core/printers'
import { PRINT_TYPE_SETTING, storedPrintTypeChoice, workspacePrintTypes } from '../core/printTypes'
import { storedUsageTracking, USAGE_TRACKING_SETTING } from '../core/usageTracking'
import { applyOnboardingProgressOperation, recordOnboardingTask } from '../core/onboarding'
import { memberRequestVisibility, visiblePeople, withMemberRequestVisibility } from '../core/visibility'
import {
  encryptSetting,
  getStoredIntegrationConfig,
  integrationConfig,
  publicIntegrationConfig,
  publicSmtpConfig,
  setStoredIntegrationConfig,
  oidcDiscoveryProblem,
} from './integrations'
import { userImage } from './avatar'
import { readEmailBranding, readWorkspaceSmtp, sendInviteEmail, workspaceEmailConfigured, workspaceMailer } from './notifications'
import {
  acceptInviteSchema,
  addAdminWorkspaceMemberSchema,
  removeAdminWorkspaceMemberSchema,
  archiveRequestsSchema,
  boardSettingsSchema,
  printTypeChoiceSchema,
  usageTrackingSchema,
  beginProviderInviteSchema,
  changeOwnEmailSchema,
  createInviteSchema,
  createLinkedRequestSchema,
  requestCoverSchema,
  createPrintGroupSchema,
  emailLogoSchema,
  emailSenderSchema,
  emailTemplateSchema,
  deletePrintGroupSchema,
  deleteRequestsSchema,
  idSchema,
  inviteInfoSchema,
  memberRequestVisibilitySchema,
  moveCopiesSchema,
  moveCopiesBatchSchema,
  recordStepUsageSchema,
  recordStockMovementSchema,
  linkSpoolmanFilamentSchema,
  createPlateSchema,
  plateIdSchema,
  recordPlateSchema,
  requestChargeSchema,
  undoUsageSchema,
  usageFiltersSchema,
  movePrintGroupSchema,
  workspaceNameConfirmationSchema,
  workspaceNameSchema,
  updatePrintGroupSchema,
  updatePrintCopyTagsSchema,
  reorderPrintGroupItemSchema,
  createConsumablesSchema,
  inventoryArchiveSchema,
  inventoryItemRefSchema,
  inventoryItemSchema,
  shareFilamentPriceSchema,
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
  selfSignupSettingsSchema,
  priceCalculatorSettingsSchema,
  onboardingUpdateSchema,
  notificationPreferenceSchema,
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
import { publicOrigin } from './origins'
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
import { INVITE_COOKIE, inviteCookiePath, normalizeAuthHeaders, writeAuthCookies } from './authCookies'
import { mutationRpc, rpc } from './rpc'
import { requestLocale, serverMessages } from './locale'
import { LOCALES } from '../core/i18n/locales'
import { workspaceMutation } from './workspaceRpc'
import { resolveSourceImage } from './sourcePreview'
import { appPath } from '../basePath'
import { SPOOLMAN_TOKEN_PREFIX } from '../core/spoolman'

const INVITE_TTL = 7 * 24 * 60 * 60 * 1000

export const canViewManagedStorageUsage = (role: Role) => role === 'admin'

const getRequestHeaders = () => normalizeAuthHeaders(getRequest().headers)
const errors = () => serverMessages().server

const me = async (instance: Awaited<ReturnType<typeof app>>) => instance.requireIdentity(getRequestHeaders())
const superAdmin = async (instance: Awaited<ReturnType<typeof app>>) => {
  const identity = await me(instance)
  if (!identity.superAdmin) throw new Response(errors().access.forbidden, { status: 403 })
  return identity
}

async function currentAuthCapabilities(instance: Awaited<ReturnType<typeof app>>): Promise<SignInCapabilities> {
  const settings = deploymentSettings(instance.repository)
  const auth = resolveAuthAdapterConfig(await getStoredIntegrationConfig(settings))
  return {
    password: auth.password,
    passwordReset: auth.password && instance.authCapabilities.emailLinks,
    socialProviders: auth.socialProviders,
    oidcName: auth.oidcName,
    selfSignup: (await resolveSelfSignupConfig(settings)).enabled,
  }
}

async function resolvedOnboardingProgress(
  repository: Repository,
  workspaceRepository: Repository,
  userId: string,
  workspaceId: string,
  isAdmin: boolean,
) {
  let progress = await repository.getUserOnboarding(userId, workspaceId)
  if (!isAdmin) return progress
  if (activeItems(await workspaceRepository.listInventory('printers')).length)
    progress = applyOnboardingProgressOperation(progress, { operation: 'complete', task: 'printers' })
  const consumables = activeItems(await workspaceRepository.listInventory('consumables'))
  if (consumables.some(({ kind }) => kind === 'resin' || kind === 'filament'))
    progress = applyOnboardingProgressOperation(progress, { operation: 'complete', task: 'stock' })
  if (await storedUsageTracking(workspaceRepository))
    progress = applyOnboardingProgressOperation(progress, { operation: 'complete', task: 'tracking' })
  return progress
}

function assertSocialProviderMutable(provider: (typeof SOCIAL_AUTH_PROVIDERS)[number]) {
  const prefix = `AUTH_${provider.toUpperCase()}`
  if (process.env[`${prefix}_CLIENT_ID`] || process.env[`${prefix}_CLIENT_SECRET`]) {
    throw new Response(errors().auth.providerControlledByEnvironment(provider), { status: 409 })
  }
}

function assertSmtpMutable() {
  if (process.env.SMTP_HOST) throw new Response(errors().email.smtpControlledByEnvironment, { status: 409 })
}

async function inviteWorkspace(instance: Awaited<ReturnType<typeof app>>, token: string) {
  const tokenHash = hashToken(token)
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
    throw new Response(errors().invite.invalid, { status: 410 })
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
  if (context.identity.role !== 'admin') throw new Response(errors().access.forbidden, { status: 403 })
  return context
}

export const reportRouteError = createServerFn({ method: 'POST' })
  .validator(routeErrorSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      captureRouteError(instance.telemetry, data)
    }),
  )

export function captureRouteError(telemetry: Pick<Telemetry, 'exception'>, data: z.infer<typeof routeErrorSchema>) {
  const error = new Error(data.message)
  error.name = data.name
  if (data.stack) error.stack = data.stack
  telemetry.exception(error, { action: 'route_error' })
}
export const createWorkspace = createServerFn({ method: 'POST' })
  .validator(z.object({ name: workspaceNameSchema }))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const workspace = await instance.createWorkspace(getRequestHeaders(), data.name)
      await instance.setActiveWorkspace(workspace.id, getRequestHeaders())
      return workspace
    }),
  )

export const deleteWorkspace = createServerFn({ method: 'POST' })
  .validator(z.object({ workspaceSlug: workspaceSlugSchema, confirmation: workspaceNameConfirmationSchema }))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      return await instance.deleteWorkspace(getRequestHeaders(), data.workspaceSlug, data.confirmation)
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
      const fleet = context ? await context.repository.listInventory('printers') : []
      const printers = activeItems(fleet)
      const printersConfigured =
        fleet.length > 0 || (context ? (await context.repository.getSetting<boolean>(PRINTERS_SKIPPED_SETTING)) === true : false)
      const printTypeChoice = context ? await storedPrintTypeChoice(context.repository) : 'automatic'
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
        locale: requestLocale(),
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
        printTypeChoice,
        printTypes: workspacePrintTypes(printTypeChoice, printers),
        usageTracking: context ? await storedUsageTracking(context.repository) : false,
        telemetryEnabled: (await resolveTelemetryConfig(deploymentSettings(instance.repository))).enabled,
        ownRequestsOnly: context ? await memberSeesOnlyOwnRequests(context.repository, context.identity) : false,
        auth: await currentAuthCapabilities(instance),
        hosted: hostedDeployment(),
        email: {
          configured: instance.authCapabilities.emailLinks,
          workspaceConfigured: await workspaceEmailConfigured(instance.emailCapabilities.configured, context?.repository),
        },
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
      return { profiles: await context.repository.listInventory('printers') }
    }),
  )

export const createInventoryItem = createServerFn({ method: 'POST' })
  .validator(inWorkspace(inventoryItemSchema))
  .handler(async ({ data: { workspaceSlug, inventory, item } }) =>
    workspaceMutation(workspaceSlug, async (context) => {
      const items = await context.service.createInventoryItem(inventory, item, context.identity)
      if (inventory === 'printers') await recordPrinterSetup(context)
      return { items }
    }),
  )

export const updateInventoryItem = createServerFn({ method: 'POST' })
  .validator(inWorkspace(inventoryItemSchema))
  .handler(async ({ data: { workspaceSlug, inventory, item } }) =>
    workspaceMutation(workspaceSlug, async (context) => ({
      items: await context.service.updateInventoryItem(inventory, item, context.identity),
    })),
  )

export const setInventoryItemArchived = createServerFn({ method: 'POST' })
  .validator(inWorkspace(inventoryArchiveSchema))
  .handler(async ({ data: { workspaceSlug, inventory, id, archived } }) =>
    workspaceMutation(workspaceSlug, async (context) => {
      const items = await context.service.setInventoryItemArchived(inventory, id, archived, context.identity)
      if (inventory === 'printers' && !archived) await recordPrinterSetup(context)
      return { items }
    }),
  )

/** What names an item, which the confirmation before deleting it states. */
export const getInventoryReferences = createServerFn({ method: 'GET' })
  .validator(inWorkspace(inventoryItemRefSchema))
  .handler(async ({ data: { workspaceSlug, inventory, id } }) =>
    rpc(async () => {
      const context = await workspaceContext(await app(), workspaceSlug)
      return await context.service.inventoryReferences(inventory, id, context.identity)
    }),
  )

export const deleteInventoryItem = createServerFn({ method: 'POST' })
  .validator(inWorkspace(inventoryItemRefSchema))
  .handler(async ({ data: { workspaceSlug, inventory, id } }) =>
    workspaceMutation(workspaceSlug, async (context) => ({
      items: await context.service.deleteInventoryItem(inventory, id, context.identity),
    })),
  )

export const createConsumables = createServerFn({ method: 'POST' })
  .validator(inWorkspace(createConsumablesSchema))
  .handler(async ({ data: { workspaceSlug, items, onHand } }) =>
    workspaceMutation(workspaceSlug, async (context) => ({
      items: await context.service.createConsumables(items, onHand, context.identity),
    })),
  )

export const shareFilamentPrice = createServerFn({ method: 'POST' })
  .validator(inWorkspace(shareFilamentPriceSchema))
  .handler(async ({ data: { workspaceSlug, consumableId } }) =>
    workspaceMutation(workspaceSlug, async (context) => ({
      items: await context.service.shareFilamentPrice(consumableId, context.identity),
    })),
  )

/** Finishes printer setup without a printer, so it is not offered again; adding one later works as usual. */
export const skipPrinterSetup = createServerFn({ method: 'POST' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) => workspaceMutation(data.workspaceSlug, (context) => context.service.skipPrinterSetup(context.identity)))

async function recordPrinterSetup(context: { identity: { id: string }; workspace: { id: string } }) {
  const instance = await app()
  await recordOnboardingTask(instance.repository, context.identity.id, 'printers', context.workspace.id).catch(() => undefined)
}

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
    const linked = await instance.auth.manageAccount.linkedProviders(getRequestHeaders())
    return {
      linked,
      availableProviders: instance.authCapabilities.socialProviders,
      oidcName: instance.authCapabilities.oidcName,
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
      if (!instance.authCapabilities.password) throw new Response(errors().account.passwordAuthDisabled, { status: 409 })
      const linked = await instance.auth.manageAccount.linkedProviders(getRequestHeaders())
      if (linked.includes('credential')) {
        throw new Response(errors().account.alreadyHasPassword, { status: 409 })
      }
      await instance.auth.api.setPassword({ body: { newPassword: data.password }, headers: getRequestHeaders() })
      instance.telemetry.capture(identity.id, 'sign_in_method_added', { provider: 'password' })
      return { configured: true }
    }),
  )

export const changeOwnEmail = createServerFn({ method: 'POST' })
  .validator(changeOwnEmailSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const identity = await me(instance)
      const linked = await instance.auth.manageAccount.linkedProviders(getRequestHeaders())
      if (!linked.includes('credential')) {
        throw new Response(errors().account.passwordBeforeEmailChange, { status: 409 })
      }
      await instance.auth.manageAccount.changeEmail({
        headers: getRequestHeaders(),
        newEmail: data.email,
        password: data.password,
      })
      instance.telemetry.capture(identity.id, 'account_email_change_requested')
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
      instance.telemetry.capture(identity.id, 'sign_in_method_removed', { provider: data.provider })
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
    const linked = await instance.auth.manageAccount.linkedProviders(getRequestHeaders())
    for (const provider of SOCIAL_AUTH_PROVIDERS) {
      settings.providers[provider].linked = linked.includes(provider)
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
        throw new Response(errors().auth.passwordControlledByEnvironment, { status: 409 })
      }
      const config = await integrationConfig(deploymentSettings(instance.repository))
      if (!data.enabled) {
        const enabledProviders = instance.authCapabilities.socialProviders
        if (enabledProviders.length === 0) throw new Response(errors().auth.socialProviderBeforeDisablingPasswords, { status: 409 })
        const linked = await instance.auth.manageAccount.linkedProviders(getRequestHeaders())
        if (!enabledProviders.some((provider) => linked.includes(provider))) {
          throw new Response(errors().auth.linkProviderBeforeDisablingPasswords, { status: 409 })
        }
      }
      await setStoredIntegrationConfig(deploymentSettings(instance.repository), { ...config, passwordEnabled: data.enabled })
      instance.telemetry.capture(identity.id, 'auth_provider_configured', { provider: 'password', enabled: data.enabled })
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
      const config = await integrationConfig(deploymentSettings(instance.repository))
      const current = config[data.provider]
      const issuer = data.provider === 'oidc' ? data.issuer : undefined
      const requiresRetest = socialProviderNeedsRetest(current, {
        clientId: data.clientId,
        clientSecret: data.clientSecret,
        issuer,
        scopes: data.provider === 'oidc' ? parseOidcScopes(data.scopes) : undefined,
      })
      const enabled = Boolean(current?.enabled && !requiresRetest)
      const anotherEnabled = SOCIAL_AUTH_PROVIDERS.some((candidate) => candidate !== data.provider && config[candidate]?.enabled)
      if (requiresRetest && current?.enabled && !instance.authCapabilities.password && !anotherEnabled) {
        throw new Response(errors().auth.passwordBeforeChangingOnlyProvider, { status: 409 })
      }
      const clientSecret = data.clientSecret || current?.clientSecret
      if (!clientSecret) throw new Response(errors().auth.clientSecretRequired, { status: 400 })
      const discoveryProblem = data.provider === 'oidc' && requiresRetest ? await oidcDiscoveryProblem(data.issuer) : undefined
      if (discoveryProblem) throw new Response(discoveryProblem, { status: 400 })
      if (current && socialProviderCredentialsChanged(current, data.clientId, data.clientSecret, issuer)) {
        const linked = await instance.auth.manageAccount.linkedProviders(getRequestHeaders())
        if (linked.includes(data.provider)) {
          await instance.auth.manageAccount.unlinkAccount({ headers: getRequestHeaders(), providerId: data.provider })
        }
      }
      await setStoredIntegrationConfig(deploymentSettings(instance.repository), {
        ...config,
        [data.provider]:
          data.provider === 'oidc'
            ? {
                enabled,
                clientId: data.clientId,
                clientSecret,
                issuer: data.issuer,
                allowSignup:
                  resolveAuthAdapterConfig(config).oidcAllowSignupSource === 'environment'
                    ? config.oidc?.allowSignup
                    : (data.allowSignup ?? config.oidc?.allowSignup),
                scopes: parseOidcScopes(data.scopes),
                name: oidcDisplayName(data.name),
              }
            : { enabled, clientId: data.clientId, clientSecret },
      })
      await resetApp()
      return { provider: data.provider, configured: true, enabled }
    }),
  )

export const updateSocialProviderEnabled = createServerFn({ method: 'POST' })
  .validator(socialProviderEnabledSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const identity = await superAdmin(instance)
      assertSocialProviderMutable(data.provider)
      const config = await integrationConfig(deploymentSettings(instance.repository))
      const provider = config[data.provider]
      if (!provider) throw new Response(errors().auth.providerNotConfigured(data.provider), { status: 400 })
      if (data.enabled) {
        const linked = await instance.auth.manageAccount.linkedProviders(getRequestHeaders())
        if (!linked.includes(data.provider)) {
          throw new Response(errors().auth.testProviderBeforeEnabling(data.provider), { status: 409 })
        }
      } else if (!instance.authCapabilities.password) {
        const remaining = SOCIAL_AUTH_PROVIDERS.some((candidate) => candidate !== data.provider && config[candidate]?.enabled)
        if (!remaining) throw new Response(errors().auth.lastAuthMethod, { status: 409 })
      }
      await setStoredIntegrationConfig(deploymentSettings(instance.repository), {
        ...config,
        [data.provider]: { ...provider, enabled: data.enabled },
      })
      instance.telemetry.capture(identity.id, 'auth_provider_configured', { provider: data.provider, enabled: data.enabled })
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
      const config = await integrationConfig(deploymentSettings(instance.repository))
      const current = resolveSmtpConfig(config, {})
      const smtp = nextSmtpConfig(current, data)
      await verifySmtp(buildEmailDelivery(smtp)!, {
        to: identity.email,
        subject: 'STL Quest email is configured',
        text: 'Your STL Quest SMTP connection is configured and working.',
        html: '<p>Your STL Quest SMTP connection is configured and working.</p>',
      })
      await setStoredIntegrationConfig(deploymentSettings(instance.repository), {
        ...config,
        smtp,
      })
      instance.telemetry.capture(identity.id, 'auth_provider_configured', { provider: 'smtp', enabled: true })
      await resetApp()
      return { configured: true }
    }),
  )

export const removeSmtpSettings = createServerFn({ method: 'POST' }).handler(async () =>
  mutationRpc(async () => {
    const instance = await app()
    await superAdmin(instance)
    assertSmtpMutable()
    const config = await integrationConfig(deploymentSettings(instance.repository))
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
        await memberSeesOnlyOwnRequests(context.repository, context.identity),
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
      // A member scoped to their own requests sees no one else — not even names.
      const board = await resolveBoardConfig(context.repository)
      return visiblePeople(await context.service.listPeople(), board, context.identity)
    }),
  )

export const listUsers = createServerFn({ method: 'GET' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const [board, members, activity] = await Promise.all([
        resolveBoardConfig(context.repository),
        context.repository.listUsers(),
        context.repository.listMemberActivity(),
      ])
      const lastActive = new Map(activity.map((entry) => [entry.userId, entry.lastActiveAt]))
      return members.map((account) => ({
        ...account,
        image: userImage(account.email, account.image),
        requestVisibility: board.memberVisibility[account.id],
        effectiveRequestVisibility: memberRequestVisibility(board, account),
        lastActiveAt: lastActive.get(account.id),
      }))
    }),
  )

export const listAccounts = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    await superAdmin(instance)
    return (await instance.repository.listAccounts()).map((account) => ({ ...account, image: userImage(account.email, account.image) }))
  }),
)

export const listAdminWorkspaces = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    await superAdmin(instance)
    return (await instance.repository.listAdminWorkspaces()).map((workspace) => ({
      ...workspace,
      owners: workspace.owners.map((owner) => ({ ...owner, image: userImage(owner.email, owner.image) })),
    }))
  }),
)

export const getAdminWorkspace = createServerFn({ method: 'GET' })
  .validator(idSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      await superAdmin(instance)
      const workspace = (await instance.repository.listAdminWorkspaces(data.id))[0]
      if (!workspace) throw new Response(errors().workspace.notFound, { status: 404 })
      const scoped = await instance.repository.scoped(workspace.id)
      const [members, configured] = await Promise.all([scoped.listUsers(), storageConfigured(scoped)])
      const config = configured ? await resolveStorageConfig(scoped) : undefined
      return {
        ...workspace,
        owners: workspace.owners.map((owner) => ({ ...owner, image: userImage(owner.email, owner.image) })),
        members: members.map((member) => ({
          id: member.id,
          name: member.name,
          email: member.email,
          image: userImage(member.email, member.image),
          role: member.workspaceRole,
        })),
        storageAdapter: config?.adapter,
      }
    }),
  )

export const removeAdminWorkspaceMember = createServerFn({ method: 'POST' })
  .validator(removeAdminWorkspaceMemberSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      await instance.removeWorkspaceMemberAsSuperAdmin(getRequestHeaders(), data.id, data.userId)
    }),
  )

export const addAdminWorkspaceMember = createServerFn({ method: 'POST' })
  .validator(addAdminWorkspaceMemberSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      await instance.addWorkspaceMemberAsSuperAdmin(getRequestHeaders(), data.id, data.userId, data.role)
    }),
  )

export const deleteAdminWorkspace = createServerFn({ method: 'POST' })
  .validator(idSchema.extend({ confirmation: workspaceNameConfirmationSchema }))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      await instance.deleteWorkspaceAsSuperAdmin(getRequestHeaders(), data.id, data.confirmation)
    }),
  )

export const getAdminAccount = createServerFn({ method: 'GET' })
  .validator(idSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      await superAdmin(instance)
      const account = await instance.repository.getAdminAccountDetails(data.id)
      if (!account) throw new Response(errors().account.notFound, { status: 404 })
      return { ...account, image: userImage(account.email, account.image) }
    }),
  )

export const deleteAccount = createServerFn({ method: 'POST' })
  .validator(idSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const identity = await superAdmin(instance)
      if (identity.id === data.id) throw new Response(errors().account.cannotDeleteSelf, { status: 409 })
      const result = await instance.deleteAccount(getRequestHeaders(), data.id)
      instance.telemetry.capture(identity.id, 'account_deleted', { deleted_workspace_count: result.deletedWorkspaceCount })
      return result
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
      instance.telemetry.capture(context.identity.id, 'workspace_member_role_changed', { role: data.role })
    }),
  )

export const removeWorkspaceMember = createServerFn({ method: 'POST' })
  .validator(z.object({ workspaceSlug: workspaceSlugSchema, userId: z.string().min(1) }))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      await context.service.removeWorkspaceMember(context.identity, data.userId)
    }),
  )

export const createInvite = createServerFn({ method: 'POST' })
  .validator(inWorkspace(createInviteSchema))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const label = data.label?.trim() ?? ''
      const mailer = data.email ? await workspaceMailer(context.repository, instance.emailDelivery, hostedDeployment()) : undefined
      if (data.email && !mailer) throw new Response(errors().invite.configureSmtp, { status: 409 })
      // The raw token exists only in this response; the database keeps a hash.
      const token = crypto.randomBytes(32).toString('base64url')
      const id = crypto.randomUUID()
      await context.repository.createInvite({
        id,
        tokenHash: hashToken(token),
        role: data.role,
        label: label || undefined,
        recipientEmail: data.email,
        expiresAt: Date.now() + INVITE_TTL,
      })
      const url = `${new URL(getRequest().url).origin}${appPath(`/invite/${token}`)}`
      if (data.email) {
        try {
          await sendInviteEmail(mailer!, await readEmailBranding(context.repository), {
            to: data.email,
            workspaceName: context.workspace.name,
            url,
          })
        } catch (error) {
          await context.repository.deleteInvite(id)
          throw new Response(errors().invite.sendFailed(errorMessage(error, errors().unknownError)), { status: 502 })
        }
      }
      instance.telemetry.capture(context.identity.id, 'invite_created', { role: data.role, emailed: Boolean(data.email) })
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
        instance.telemetry.capture(context.identity.id, 'invite_revoked', { role: invite.role, emailed: Boolean(invite.recipientEmail) })
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
      const workspaceSlug = await instance.repository.workspaceSlugForInvite(hashToken(data.token), Date.now())
      if (!workspaceSlug) {
        return { valid: false, signedIn: false, joined: false, auth: await currentAuthCapabilities(instance) }
      }
      const workspace = (await instance.repository.workspaceBySlug(workspaceSlug))!
      const context = await instance.publicWorkspace(workspaceSlug)
      const invite = await context.repository.findInvite(hashToken(data.token))
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
        throw new Response(errors().auth.providerNotEnabled(data.provider), { status: 400 })
      }
      setCookie(INVITE_COOKIE, data.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: new URL(getRequest().url).protocol === 'https:',
        path: inviteCookiePath(),
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
        throw new Response(errors().invite.otherEmail, { status: 403 })
      }
      if (await instance.repository.accountExists(data.email)) {
        throw new Response(errors().invite.accountExists, { status: 409 })
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
      await instance.repository.ensurePersonalWorkspace(created.response.user, serverMessages().common)
      instance.telemetry.capture(created.response.user.id, 'invite_accepted', {})
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
      if (!identity) throw new Response(errors().access.unauthenticated, { status: 401 })
      const resolved = await inviteWorkspace(instance, data.token)
      if (!resolved) throw new Response(errors().invite.invalid, { status: 410 })
      const { tokenHash, workspace, context } = resolved
      const accepted = await context.repository.acceptInviteForUser(tokenHash, Date.now(), identity)
      if (!accepted) throw new Response(errors().invite.invalid, { status: 410 })
      await instance.setActiveWorkspace(workspace.id, headers)
      context.events.publish('user.created')
      instance.telemetry.capture(identity.id, 'invite_accepted', {})
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
    const context = await instance.workspace(getRequestHeaders())
    return resolvedOnboardingProgress(
      instance.repository,
      context.repository,
      context.identity.id,
      context.workspace.id,
      context.identity.role === 'admin',
    )
  }),
)

export const updateOnboardingProgress = createServerFn({ method: 'POST' })
  .validator(onboardingUpdateSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const context = await instance.workspace(getRequestHeaders())
      const identity = context.identity
      if (data.operation === 'complete') return recordOnboardingTask(instance.repository, identity.id, data.task, context.workspace.id)
      const current = await resolvedOnboardingProgress(
        instance.repository,
        context.repository,
        identity.id,
        context.workspace.id,
        identity.role === 'admin',
      )
      const next = applyOnboardingProgressOperation(current, data)
      await instance.repository.saveUserOnboarding(identity.id, next, context.workspace.id)
      return next
    }),
  )

export const getNotificationPreferences = createServerFn({ method: 'GET' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const context = await workspaceContext(await app(), data.workspaceSlug)
      return context.service.notificationPreferences(context.identity)
    }),
  )

export const updateLocale = createServerFn({ method: 'POST' })
  .validator(z.object({ locale: z.enum(LOCALES).optional() }))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const identity = await instance.requireIdentity(getRequestHeaders())
      await instance.repository.setUserLocale(identity.id, data.locale)
      instance.telemetry.capture(identity.id, 'interface_language_changed', { locale: data.locale ?? 'browser' })
    }),
  )

export const updateNotificationPreference = createServerFn({ method: 'POST' })
  .validator(inWorkspace(notificationPreferenceSchema))
  .handler(async ({ data }) =>
    workspaceMutation(data.workspaceSlug, (context) =>
      context.service.setNotificationPreference(data.kind, data.enabled, context.identity),
    ),
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

export const updateSelfSignupSettings = createServerFn({ method: 'POST' })
  .validator(selfSignupSettingsSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const identity = await superAdmin(instance)
      const config = { enabled: data.enabled }
      await instance.repository.setDeploymentSetting(SELF_SIGNUP_SETTING, config)
      instance.telemetry.capture(identity.id, 'self_signup_configured', { enabled: data.enabled })
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

export const getConsumables = createServerFn({ method: 'GET' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      return { consumables: await context.repository.listInventory('consumables') }
    }),
  )

// Read by admins only, like consumables: the steps that ask which equipment a print used are admin board moves.
export const getEquipment = createServerFn({ method: 'GET' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      return { equipment: await context.repository.listInventory('equipment') }
    }),
  )

export const getPriceCalculatorSettings = createServerFn({ method: 'GET' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      return storedPriceCalculatorSettings(await context.repository.getSetting<object>(PRICE_CALCULATOR_SETTING))
    }),
  )

export function storedPriceCalculatorSettings(stored: object | undefined) {
  const settings = priceCalculatorSettingsSchema.safeParse({ ...DEFAULT_PRICE_CALCULATOR_SETTINGS, ...stored })
  return { settings: settings.success ? settings.data : DEFAULT_PRICE_CALCULATOR_SETTINGS, saved: stored !== undefined }
}

export const savePriceCalculatorSettings = createServerFn({ method: 'POST' })
  .validator(inWorkspace(priceCalculatorSettingsSchema))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const { workspaceSlug: _, ...settings } = data
      await context.repository.setSetting(PRICE_CALCULATOR_SETTING, settings)
      context.events.publish('settings.changed')
      instance.telemetry.capture(context.identity.id, 'price_calculator_settings_saved', {
        currency: settings.currency,
        electricity_preset: Boolean(settings.electricityCountryCode),
      })
      return settings
    }),
  )

export const getEmailBranding = createServerFn({ method: 'GET' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const { logo, sender, templates } = await readEmailBranding(context.repository)
      return {
        logo: logo ?? null,
        sender: sender ?? {},
        templates: templates ?? {},
        smtp: publicSmtpConfig(await readWorkspaceSmtp(context.repository)),
      }
    }),
  )

export const saveEmailLogo = createServerFn({ method: 'POST' })
  .validator(inWorkspace(emailLogoSchema))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const logo = data.data === null ? null : parseEmailLogo(data.data)
      if (logo) await context.repository.setSetting(EMAIL_LOGO_SETTING, logo)
      else await context.repository.deleteSetting(EMAIL_LOGO_SETTING)
      context.events.publish('settings.changed')
      instance.telemetry.capture(context.identity.id, 'email_logo_updated', { has_logo: Boolean(logo) })
      return { logo }
    }),
  )

export const saveEmailSender = createServerFn({ method: 'POST' })
  .validator(inWorkspace(emailSenderSchema))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const sender: EmailSender = { ...(data.name && { name: data.name }), ...(data.replyTo && { replyTo: data.replyTo }) }
      if (sender.name || sender.replyTo) await context.repository.setSetting(EMAIL_SENDER_SETTING, sender)
      else await context.repository.deleteSetting(EMAIL_SENDER_SETTING)
      context.events.publish('settings.changed')
      instance.telemetry.capture(context.identity.id, 'email_sender_updated', {
        has_name: Boolean(sender.name),
        has_reply_to: Boolean(sender.replyTo),
      })
      return { sender }
    }),
  )

export const saveWorkspaceSmtp = createServerFn({ method: 'POST' })
  .validator(inWorkspace(smtpEmailSettingsSchema))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const { workspaceSlug: _, ...input } = data
      const hosted = hostedDeployment()
      assertWorkspaceSmtpPort(input.port, hosted)
      const current = await readWorkspaceSmtp(context.repository)
      const smtp = nextSmtpConfig(current, input)
      const { logoSrc, ...headers } = brandedEmailParts(await readEmailBranding(context.repository), false)
      await verifySmtp(workspaceEmailDelivery(smtp, hosted), {
        to: context.identity.email,
        ...mailServerTestEmail({ t: serverMessages().email, workspaceName: context.workspace.name, logoSrc }),
        ...headers,
      })
      await context.repository.setSetting(WORKSPACE_SMTP_SETTING, encryptSetting(smtp))
      context.events.publish('settings.changed')
      instance.telemetry.capture(context.identity.id, 'workspace_smtp_configured', {
        secure: smtp.secure,
        authenticated: Boolean(smtp.user),
      })
      return publicSmtpConfig(smtp)
    }),
  )

/** Signs in and sends a test message, so a broken configuration is reported before it is saved. */
async function verifySmtp(delivery: EmailDelivery, test: EmailMessage) {
  try {
    await delivery.verify()
    await delivery.send(test)
  } catch (error) {
    throw new Response(errors().email.smtpVerificationFailed(errorMessage(error, errors().unknownError)), { status: 400 })
  }
}

export function assertWorkspaceSmtpPort(port: number, hosted: boolean) {
  if (hosted && !hostedSmtpPortAllowed(port)) throw new Response(errors().email.submissionPort(HOSTED_SMTP_PORTS), { status: 400 })
}

export const saveEmailTemplate = createServerFn({ method: 'POST' })
  .validator(inWorkspace(emailTemplateSchema))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const templates = nextEmailTemplates(
        await context.repository.getSetting<EmailTemplates>(EMAIL_TEMPLATES_SETTING),
        data,
        (await readWorkspaceSmtp(context.repository)) !== undefined,
      )
      if (Object.keys(templates).length) await context.repository.setSetting(EMAIL_TEMPLATES_SETTING, templates)
      else await context.repository.deleteSetting(EMAIL_TEMPLATES_SETTING)
      context.events.publish('settings.changed')
      instance.telemetry.capture(context.identity.id, 'email_template_saved', { kind: data.kind, customized: Boolean(data.template) })
      return { templates }
    }),
  )

/** Custom markup is only sent from the workspace's own mail server, never from a shared sending address. */
export function nextEmailTemplates(
  current: EmailTemplates | undefined,
  change: { kind: EmailTemplateKind; template: EmailTemplate | null },
  ownServer: boolean,
): EmailTemplates {
  if (change.template && !ownServer) throw new Response(errors().email.ownServerForTemplates, { status: 409 })
  const { [change.kind]: _, ...others } = current ?? {}
  return change.template ? { ...others, [change.kind]: change.template } : others
}

/** A blank password keeps the stored one only for the same server and account, so editing the host cannot send it elsewhere. */
export function nextSmtpConfig(current: SmtpEmailConfig | undefined, input: z.infer<typeof smtpEmailSettingsSchema>): SmtpEmailConfig {
  const sameAccount = current?.host === input.host && current.user === input.user
  return { ...input, password: input.password || (sameAccount ? current.password : undefined), testedAt: Date.now() }
}

export const removeWorkspaceSmtp = createServerFn({ method: 'POST' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      await context.repository.deleteSetting(WORKSPACE_SMTP_SETTING)
      context.events.publish('settings.changed')
      instance.telemetry.capture(context.identity.id, 'workspace_smtp_removed')
      return publicSmtpConfig(undefined)
    }),
  )

export function parseEmailLogo(data: string): EmailLogo {
  const bytes = Buffer.from(data, 'base64')
  if (bytes.byteLength > MAX_EMAIL_LOGO_BYTES) throw new Response(errors().email.logoTooLarge(MAX_EMAIL_LOGO_BYTES / 1024), { status: 413 })
  const contentType = imageContentType(bytes)
  if (!contentType || !isEmailLogoType(contentType)) throw new Response(errors().email.logoType, { status: 400 })
  return { contentType, data: bytes.toString('base64') }
}

export const getDiagnostics = createServerFn({ method: 'GET' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const storageDiagnostics = context.storageReady
        ? await context.refreshDiagnostics()
        : { storageCapacity: undefined, storageReady: false, storageError: context.storageError }
      const visualJobs = await Promise.all(
        (await context.repository.listAssetGenerationJobs()).map(async (job) => {
          const request = await context.repository.getRequest(job.requestId)
          return { ...job, kind: job.stage, name: request?.name ?? 'Deleted model', fileName: request?.fileName }
        }),
      )
      return {
        storage: context.storage.adapter,
        storageReady: storageDiagnostics.storageReady && !hostedStorageRequiresRemote(context.storage),
        storageError: storageDiagnostics.storageError,
        queue: context.assetQueue.stats(),
        backgroundJobs: visualJobs.sort((first, second) => first.queuedAt - second.queuedAt),
        incompleteUploads: await context.repository.incompleteUploadStats(Date.now()),
        storageCapacity: storageDiagnostics.storageCapacity,
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
      const { autoArchiveDays: storedAutoArchiveDays, ...current } = await resolveBoardConfig(context.repository)
      const autoArchiveDays = data.autoArchiveDays === undefined ? storedAutoArchiveDays : (data.autoArchiveDays ?? undefined)
      const config: BoardConfig = {
        ...current,
        privateRequests: data.privateRequests ?? current.privateRequests,
        ...(autoArchiveDays === undefined ? {} : { autoArchiveDays }),
      }
      await context.repository.setSetting('board', config)
      // Boards refetch through the workspace realtime channel so requester views update immediately.
      context.events.publish('board.changed')
      if (data.privateRequests !== undefined)
        instance.telemetry.capture(context.identity.id, 'board_visibility_changed', {
          private_requests: config.privateRequests,
          workspace_id: context.workspace.id,
          member_overrides: Object.keys(config.memberVisibility).length,
        })
      // Sweep straight away so newly eligible prints leave the board without waiting for the hourly round.
      if (data.autoArchiveDays) await context.sweepAutoArchive()
      return config
    }),
  )

export const updatePrintTypeChoice = createServerFn({ method: 'POST' })
  .validator(inWorkspace(printTypeChoiceSchema))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      await context.repository.setSetting(PRINT_TYPE_SETTING, data.choice)
      // Every member's upload form and board narrow to the new types on their next session refetch.
      context.events.publish('settings.changed')
      instance.telemetry.capture(context.identity.id, 'print_types_chosen', { choice: data.choice })
      return { choice: data.choice }
    }),
  )

export const updateUsageTracking = createServerFn({ method: 'POST' })
  .validator(inWorkspace(usageTrackingSchema))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      await context.repository.setSetting(USAGE_TRACKING_SETTING, data.enabled)
      // Every admin's board starts or stops asking what each step used on their next session refetch.
      context.events.publish('settings.changed')
      instance.telemetry.capture(context.identity.id, 'usage_tracking_changed', { enabled: data.enabled, source: data.source })
      return { enabled: data.enabled }
    }),
  )

export const updateMemberRequestVisibility = createServerFn({ method: 'POST' })
  .validator(inWorkspace(memberRequestVisibilitySchema))
  .handler(async ({ data }) =>
    mutationRpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const members = await context.repository.listUsers()
      if (!members.some((member) => member.id === data.userId)) throw new Response(errors().workspace.memberNotFound, { status: 404 })
      const config = withMemberRequestVisibility(await resolveBoardConfig(context.repository), data.userId, data.visibility)
      await context.repository.setSetting('board', config)
      // The member's own board, people list, and realtime subscription all rescope on the next fetch.
      context.events.publish('board.changed')
      instance.telemetry.capture(context.identity.id, 'board_member_visibility_changed', {
        visibility: data.visibility,
        workspace_id: context.workspace.id,
        member_overrides: Object.keys(config.memberVisibility).length,
      })
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
      if (!localStorageEnabled()) throw new Response(errors().storage.localUnavailable, { status: 403 })
      if (!path.isAbsolute(data.path)) throw new Response(errors().storage.absolutePath, { status: 400 })
      const directory = path.resolve(data.path)
      let directories: Awaited<ReturnType<typeof storageDirectories>>
      try {
        directories = await storageDirectories(directory)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        const problems = serverMessages().storage.problems
        const message = code === 'EACCES' ? problems.unreadable : code === 'ENOTDIR' ? problems.notAFolder : problems.missing
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
      if (!clientSecret) throw new Response(errors().storage.appSecretRequired(cloudStorageProviderName(data.provider)), { status: 400 })
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
      if (!current) throw new Response(errors().storage.notSetUp(cloudStorageProviderName(data.provider)), { status: 409 })
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
        throw new Response(errors().storage.moveWorkspacesBeforeRemovingApp(cloudStorageProviderName(data.provider)), { status: 409 })
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
        throw new Response(errors().storage.moveStorageBeforeDisconnecting(cloudStorageProviderName(data.provider)), { status: 409 })
      if ((await context.repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING))?.state === 'running')
        throw new Response(errors().storage.waitForMigration, { status: 409 })
      await disconnectCloudStorage(context.repository, data.provider)
      instance.telemetry.capture(context.identity.id, 'cloud_storage_disconnected', { provider: data.provider })
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
        if (!ownerId) throw new Response(errors().workspace.ownerNotFound, { status: 409 })
        claimedManagedStorage = await context.repository.claimManagedStorage(ownerId, HOSTED_OWNED_WORKSPACE_LIMIT)
      }
      let migration: StorageMigration
      try {
        migration = await context.storageMigration.start(config, data.destinationAction === 'clear-all')
      } catch (error) {
        if (claimedManagedStorage) await context.repository.releaseManagedStorage()
        throw error
      }
      instance.telemetry.capture(context.identity.id, 'storage_migration_started', { from: context.storage.adapter, to: config.adapter })
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
      instance.telemetry.capture(context.identity.id, 'storage_migration_retried', { adapter: retried.destination.adapter })
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
      instance.telemetry.capture(context.identity.id, 'storage_migration_cancelled', {
        adapter: cancelled.destination.adapter,
        files_copied: cancelled.copiedFiles,
      })
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
          throw new Response(errors().storage.chooseDifferentLocation, { status: 400 })
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
        if (data.destinationAction === 'clear-all') throw new Response(errors().storage.replaceThroughMigration, { status: 409 })

        let claimedManagedStorage = false
        if (config.adapter === 'managed') {
          const ownerId = await context.repository.workspaceOwnerId()
          if (!ownerId) throw new Response(errors().workspace.ownerNotFound, { status: 409 })
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
        instance.telemetry.capture(context.identity.id, 'storage_configured', {
          previous_adapter: alreadyConfigured ? context.storage.adapter : undefined,
          adapter: config.adapter,
          configuration_kind: storageConfigurationKind(alreadyConfigured, context.storage, config),
        })
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

export const recordStepUsage = createServerFn({ method: 'POST' })
  .validator(inWorkspace(recordStepUsageSchema))
  .handler(async ({ data }) => {
    const { workspaceSlug, ...input } = data
    return workspaceMutation(workspaceSlug, (context) => context.service.recordStepUsage(input, context.identity))
  })

export const recordStockMovement = createServerFn({ method: 'POST' })
  .validator(inWorkspace(recordStockMovementSchema))
  .handler(async ({ data }) => {
    const { workspaceSlug, ...input } = data
    return workspaceMutation(workspaceSlug, (context) => context.service.recordStockMovement(input, context.identity))
  })

export const undoUsage = createServerFn({ method: 'POST' })
  .validator(inWorkspace(undoUsageSchema))
  .handler(async ({ data }) =>
    workspaceMutation(data.workspaceSlug, (context) => context.service.undoUsage(data.transactionId, context.identity)),
  )

export const listUsage = createServerFn({ method: 'GET' })
  .validator(inWorkspace(usageFiltersSchema))
  .handler(async ({ data }) =>
    rpc(async () => {
      const { workspaceSlug, ...filters } = data
      const context = await workspaceContext(await app(), workspaceSlug)
      return { events: await context.service.listUsage(filters, context.identity) }
    }),
  )

export const getStockLevels = createServerFn({ method: 'GET' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const context = await workspaceContext(await app(), data.workspaceSlug)
      return { stock: await context.service.stockLevels(context.identity) }
    }),
  )

export const getSpoolman = createServerFn({ method: 'GET' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const context = await workspaceContext(await app(), data.workspaceSlug)
      const spoolman = await context.service.spoolman(context.identity)
      const origin = new URL(getRequest().url).origin
      return { ...spoolman, appUrl: `${origin}${appPath('')}`, ingestUrl: `${origin}${appPath('/api/spoolman/spools')}` }
    }),
  )

export const connectSpoolman = createServerFn({ method: 'POST' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    workspaceMutation(data.workspaceSlug, async (context) => {
      // The raw token exists only in this response; the database keeps a hash.
      const token = `${SPOOLMAN_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`
      await context.service.connectSpoolman(hashToken(token), context.identity)
      return { token }
    }),
  )

export const disconnectSpoolman = createServerFn({ method: 'POST' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) => workspaceMutation(data.workspaceSlug, (context) => context.service.disconnectSpoolman(context.identity)))

export const linkSpoolmanFilament = createServerFn({ method: 'POST' })
  .validator(inWorkspace(linkSpoolmanFilamentSchema))
  .handler(async ({ data }) => {
    const { workspaceSlug, ...input } = data
    return workspaceMutation(workspaceSlug, (context) => context.service.linkSpoolmanFilament(input, context.identity))
  })

export const getUsagePrefills = createServerFn({ method: 'GET' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const context = await workspaceContext(await app(), data.workspaceSlug)
      return await context.service.usagePrefills(context.identity)
    }),
  )

export const getChargedPrints = createServerFn({ method: 'GET' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const context = await workspaceContext(await app(), data.workspaceSlug)
      return { prints: await context.service.chargedPrints(context.identity) }
    }),
  )

export const getUsageBackfillPreview = createServerFn({ method: 'GET' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const context = await workspaceContext(await app(), data.workspaceSlug)
      return await context.service.usageBackfillPreview(context.identity)
    }),
  )

export const backfillUsage = createServerFn({ method: 'POST' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) => workspaceMutation(data.workspaceSlug, (context) => context.service.backfillUsage(context.identity)))

export const getPlates = createServerFn({ method: 'GET' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const context = await workspaceContext(await app(), data.workspaceSlug)
      return { plates: await context.service.listPlates(context.identity) }
    }),
  )

export const createPlate = createServerFn({ method: 'POST' })
  .validator(inWorkspace(createPlateSchema))
  .handler(async ({ data }) => {
    const { workspaceSlug, ...input } = data
    return workspaceMutation(workspaceSlug, (context) => context.service.createPlate(input, context.identity))
  })

export const recordPlate = createServerFn({ method: 'POST' })
  .validator(inWorkspace(recordPlateSchema))
  .handler(async ({ data }) => {
    const { workspaceSlug, ...input } = data
    return workspaceMutation(workspaceSlug, (context) => context.service.recordPlate(input, context.identity))
  })

export const deletePlate = createServerFn({ method: 'POST' })
  .validator(inWorkspace(plateIdSchema))
  .handler(async ({ data }) =>
    workspaceMutation(data.workspaceSlug, (context) => context.service.deletePlate(data.plateId, context.identity)),
  )

export const setRequestCharge = createServerFn({ method: 'POST' })
  .validator(inWorkspace(requestChargeSchema))
  .handler(async ({ data }) =>
    workspaceMutation(data.workspaceSlug, (context) => context.service.setRequestCharge(data.id, data.amount, context.identity)),
  )

export const createLinkedRequest = createServerFn({ method: 'POST' })
  .validator(inWorkspace(createLinkedRequestSchema))
  .handler(async ({ data }) => {
    const { workspaceSlug, cover, ...input } = data
    return workspaceMutation(workspaceSlug, async (context) => {
      if (cover !== undefined) {
        return context.service.createLinkedRequest({ ...input, cover: Buffer.from(cover, 'base64') }, context.identity)
      }
      const sourceImageUrl = await resolveSourceImage(input.sourceUrl)
      return context.service.createLinkedRequest({ ...input, sourceImageUrl }, context.identity)
    })
  })

export const setRequestCover = createServerFn({ method: 'POST' })
  .validator(inWorkspace(requestCoverSchema))
  .handler(async ({ data }) =>
    workspaceMutation(data.workspaceSlug, (context) =>
      context.service.setCover(data.id, Buffer.from(data.image, 'base64'), context.identity),
    ),
  )

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
    workspaceMutation(data.workspaceSlug, (context) => context.service.moveGroup(data.id, data.from, data.to, context.identity)),
  )

export const updatePrintGroup = createServerFn({ method: 'POST' })
  .validator(inWorkspace(updatePrintGroupSchema))
  .handler(async ({ data }) => {
    const { workspaceSlug, id, ...fields } = data
    return workspaceMutation(workspaceSlug, (context) => context.service.updateGroup(id, fields, context.identity))
  })

export const updatePrintCopyTags = createServerFn({ method: 'POST' })
  .validator(inWorkspace(updatePrintCopyTagsSchema))
  .handler(async ({ data }) => {
    const { workspaceSlug, ...edit } = data
    return workspaceMutation(workspaceSlug, (context) => context.service.updateCopyTags(edit, context.identity))
  })

export const deletePrintGroup = createServerFn({ method: 'POST' })
  .validator(inWorkspace(deletePrintGroupSchema))
  .handler(async ({ data }) => workspaceMutation(data.workspaceSlug, (context) => context.service.deleteGroup(data.id, context.identity)))

export const reorderPrintGroupItem = createServerFn({ method: 'POST' })
  .validator(inWorkspace(reorderPrintGroupItemSchema))
  .handler(async ({ data }) =>
    workspaceMutation(data.workspaceSlug, (context) =>
      context.service.reorderGroupItem(data.groupId, data.status, data.requestId, data.targetRequestId, data.edge, context.identity),
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
    return workspaceMutation(workspaceSlug, async (context) => {
      const current = await context.service.getRequest(id)
      const coverChange = current ? sourceCoverChange(current, fields.sourceUrl) : 'keep'
      const found = coverChange === 'keep' ? undefined : await resolveSourceImage(fields.sourceUrl!)
      const sourceImageUrl = coverChange === 'replace' ? (found ?? null) : found
      return context.service.update(id, { ...fields, sourceImageUrl }, context.identity)
    })
  })

export const repeatRequest = createServerFn({ method: 'POST' })
  .validator(inWorkspace(repeatRequestSchema))
  .handler(async ({ data }) =>
    workspaceMutation(data.workspaceSlug, async (context) => {
      const requestId = await context.service.repeatRequest(data.id, data.quantity, context.identity)
      const request = await context.service.getRequest(requestId)
      if (request?.filePath) await context.assetQueue.enqueue(requestId)
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

export const archiveRequests = createServerFn({ method: 'POST' })
  .validator(inWorkspace(archiveRequestsSchema))
  .handler(async ({ data }) =>
    workspaceMutation(data.workspaceSlug, (context) => context.service.archiveRequests(data.ids, context.identity)),
  )

export const unarchiveRequests = createServerFn({ method: 'POST' })
  .validator(inWorkspace(archiveRequestsSchema))
  .handler(async ({ data }) =>
    workspaceMutation(data.workspaceSlug, (context) => context.service.unarchiveRequests(data.ids, context.identity)),
  )
