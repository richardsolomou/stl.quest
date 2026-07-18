import crypto from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setCookie } from '@tanstack/react-start/server'
import { eq } from 'drizzle-orm'
import { resolveAuthAdapterConfig } from '../adapters/auth'
import { buildEmailDelivery, resolveSmtpConfig } from '../adapters/email'
import { user } from '../db/schema'
import {
  app,
  buildAssetStore,
  deploymentSettings,
  hashInviteToken,
  resetApp,
  resolveBoardConfig,
  resolveStorageConfig,
  resolveTelemetryConfig,
} from './app'
import { workflow } from '../core/workflow'
import { SOCIAL_AUTH_PROVIDERS, type IntegrationConfig } from '../core/auth'
import type { StorageConfig, StorageMigration } from '../core/types'
import { encryptSetting, getStoredIntegrationConfig, publicIntegrationConfig, setStoredIntegrationConfig } from './integrations'
import { requireMutationOrigin } from './mutationOrigin'
import { userImage } from './avatar'
import {
  acceptInviteSchema,
  boardSettingsSchema,
  beginProviderInviteSchema,
  createInviteSchema,
  idSchema,
  inviteInfoSchema,
  moveCopiesSchema,
  plateModelAnalysesSchema,
  platePlannerDraftSchema,
  printerProfilesSchema,
  reorderRequestSchema,
  requestFiltersSchema,
  setOwnPasswordSchema,
  passwordAuthSettingsSchema,
  socialProviderEnabledSchema,
  socialProviderSettingsSchema,
  smtpEmailSettingsSchema,
  storageDirectorySchema,
  storageSettingsSchema,
  cloudConnectionSchema,
  cloudProviderSchema,
  telemetrySettingsSchema,
  updateRequestSchema,
} from './schemas'
import { beginDropboxAuthorization, disconnectDropbox, publicDropboxConnection } from './dropboxConnection'
import { beginGoogleDriveAuthorization, disconnectGoogleDrive, publicGoogleDriveConnection } from './googleDriveConnection'
import { beginOneDriveAuthorization, disconnectOneDrive, publicOneDriveConnection } from './oneDriveConnection'
import { normalizePrinterProfile, type PlatePlannerDraft, type PrinterProfile } from '../core/platePlanner'
import { STORAGE_MIGRATION_SETTING } from './storageMigration'
import { systemDiagnostics } from './operations'
import { storageDirectories } from './storageDirectories'

const INVITE_TTL = 7 * 24 * 60 * 60 * 1000

// The app throws Response for HTTP handlers, but a Response thrown inside a
// server fn is delivered as a plain response and the client promise resolves
// as if the call succeeded. Convert to real errors so callers can catch.
async function rpc<T>(work: () => Promise<T> | T): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof Response) throw new Error((await error.text()) || `request failed (${error.status})`, { cause: error })
    throw error
  }
}

const me = async (instance: Awaited<ReturnType<typeof app>>) => instance.requireIdentity(getRequest().headers)
const admin = async (instance: Awaited<ReturnType<typeof app>>) => {
  const identity = await me(instance)
  if (identity.role !== 'admin') throw new Response('forbidden', { status: 403 })
  return identity
}

function integrationConfig(instance: Awaited<ReturnType<typeof app>>): IntegrationConfig {
  return getStoredIntegrationConfig(deploymentSettings(instance.repository)) ?? { passwordEnabled: true }
}

const workspaceSlugSchema = z.string().trim().min(1).max(100)
const workspaceInputSchema = z.object({ workspaceSlug: workspaceSlugSchema })
const inWorkspace = <T extends z.ZodType>(schema: T) => z.intersection(schema, workspaceInputSchema)
const workspaceContext = async (instance: Awaited<ReturnType<typeof app>>, workspaceSlug?: string) =>
  instance.workspace(getRequest().headers, workspaceSlug)
const workspaceAdmin = async (instance: Awaited<ReturnType<typeof app>>, workspaceSlug?: string) => {
  const context = await workspaceContext(instance, workspaceSlug)
  if (context.identity.role !== 'admin') throw new Response('forbidden', { status: 403 })
  return context
}
export const createWorkspace = createServerFn({ method: 'POST' })
  .validator(z.object({ name: z.string().trim().min(1).max(80) }))
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const workspace = await instance.createWorkspace(getRequest().headers, data.name)
      await instance.setActiveWorkspace(workspace.id, getRequest().headers)
      return workspace
    }),
  )

export const deleteWorkspace = createServerFn({ method: 'POST' })
  .validator(z.object({ workspaceSlug: workspaceSlugSchema, confirmation: z.string().max(80) }))
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      return instance.deleteWorkspace(getRequest().headers, data.workspaceSlug, data.confirmation)
    }),
  )

export const switchWorkspace = createServerFn({ method: 'POST' })
  .validator(z.object({ workspaceId: z.string().min(1) }))
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      return instance.setActiveWorkspace(data.workspaceId, getRequest().headers)
    }),
  )

export const sessionInfo = createServerFn({ method: 'GET' })
  .validator(z.object({ workspaceSlug: workspaceSlugSchema.optional() }))
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      const identity = await instance.identity(getRequest().headers)
      const authenticated = identity ? await instance.requireIdentity(getRequest().headers) : undefined
      const workspaces = authenticated ? instance.listWorkspaces(authenticated.id) : []
      const context = authenticated ? await instance.workspace(getRequest().headers, data.workspaceSlug) : undefined
      const storedPrinters = context?.repository.getSetting<PrinterProfile[]>('plate-planner-profiles')
      const printers = (storedPrinters ?? []).map(normalizePrinterProfile).map((profile) =>
        profile.printType === 'filament'
          ? {
              id: profile.id,
              name: profile.name,
              printType: profile.printType,
              enabled: profile.enabled,
              filamentDiameterMm: profile.filamentDiameterMm,
              materialDensityGPerCm3: profile.materialDensityGPerCm3,
            }
          : { id: profile.id, name: profile.name, printType: profile.printType, enabled: profile.enabled },
      )
      return {
        identity: context?.identity ?? identity,
        workspaces,
        workspace: context?.workspace,
        setupRequired: instance.repository.countUsers() === 0,
        storageConfigured:
          context?.repository.getSetting('storageEncrypted') !== undefined || context?.repository.getSetting('storage') !== undefined,
        storageReady: context?.storageReady ?? false,
        printersConfigured: storedPrinters !== undefined,
        printers,
        telemetryEnabled: resolveTelemetryConfig(deploymentSettings(instance.repository)).enabled,
        privateRequests: context ? resolveBoardConfig(context.repository).privateRequests : false,
        planningStrategy: context ? resolveBoardConfig(context.repository).planningStrategy : 'balanced',
        auth: instance.authCapabilities,
        hosted: process.env.PRINTHUB_HOSTED === 'true',
        email: instance.emailCapabilities,
        workflow,
      }
    }),
  )

export const getPlatePlannerState = createServerFn({ method: 'GET' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const profiles = context.repository.getSetting<PrinterProfile[]>('plate-planner-profiles')?.map(normalizePrinterProfile)
      const enabledPrinterIds = new Set(profiles?.filter((profile) => profile.enabled).map((profile) => profile.id))
      const drafts = context.repository.getSetting<Record<string, PlatePlannerDraft>>('plate-planner-drafts') ?? {}
      return {
        profiles,
        drafts: Object.fromEntries(Object.entries(drafts).filter(([printerId]) => enabledPrinterIds.has(printerId))),
        analyses: context.repository.listPlateModelAnalyses(),
        analysisJobs: context.repository.listOrientationAnalysisJobs(),
        queue: context.assetQueue.stats(),
      }
    }),
  )

export const savePlatePlannerProfiles = createServerFn({ method: 'POST' })
  .validator(inWorkspace(printerProfilesSchema))
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const reanalyzeRequestIds = context.repository.replacePrinterProfiles(data.profiles)?.reanalyzeRequestIds ?? []
      for (const requestId of reanalyzeRequestIds) context.assetQueue.enqueueAnalysis(requestId)
      context.events.publish('settings.changed')
      return { saved: true }
    }),
  )

export const savePlateModelAnalyses = createServerFn({ method: 'POST' })
  .validator(inWorkspace(plateModelAnalysesSchema))
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      context.repository.upsertPlateModelAnalyses(data.analyses)
      return { saved: data.analyses.length }
    }),
  )

export const savePlatePlannerDraft = createServerFn({ method: 'POST' })
  .validator(inWorkspace(platePlannerDraftSchema))
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const profiles = context.repository.getSetting<PrinterProfile[]>('plate-planner-profiles') ?? []
      const printer = profiles.find((profile) => profile.id === data.draft.printerId)
      if (!printer) throw new Response('unknown printer', { status: 400 })
      if (!normalizePrinterProfile(printer).enabled) throw new Response('printer is disabled', { status: 400 })
      const drafts = context.repository.getSetting<Record<string, PlatePlannerDraft>>('plate-planner-drafts') ?? {}
      drafts[data.draft.printerId] = data.draft
      context.repository.setSetting('plate-planner-drafts', drafts)
      return { saved: true }
    }),
  )

export const getAccountMethods = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    await me(instance)
    const accounts = await instance.auth.api.listUserAccounts({ headers: getRequest().headers })
    return {
      linked: accounts.map((account) => account.providerId),
      availableProviders: instance.authCapabilities.socialProviders,
      passwordAvailable: instance.authCapabilities.password,
    }
  }),
)

export const setOwnPassword = createServerFn({ method: 'POST' })
  .validator(setOwnPasswordSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      await me(instance)
      if (!instance.authCapabilities.password) throw new Response('password authentication is disabled', { status: 409 })
      const accounts = await instance.auth.api.listUserAccounts({ headers: getRequest().headers })
      if (accounts.some((account) => account.providerId === 'credential')) {
        throw new Response('this account already has a password', { status: 409 })
      }
      await instance.auth.api.setPassword({ body: { newPassword: data.password }, headers: getRequest().headers })
      return { configured: true }
    }),
  )

export const getIntegrationSettings = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    await admin(instance)
    const stored = getStoredIntegrationConfig(deploymentSettings(instance.repository))
    const settings = publicIntegrationConfig(stored, resolveAuthAdapterConfig(stored), resolveSmtpConfig(stored))
    const accounts = await instance.auth.api.listUserAccounts({ headers: getRequest().headers })
    for (const provider of SOCIAL_AUTH_PROVIDERS) {
      settings.providers[provider].linked = accounts.some((account) => account.providerId === provider)
    }
    return settings
  }),
)

export const updatePasswordAuth = createServerFn({ method: 'POST' })
  .validator(passwordAuthSettingsSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      await admin(instance)
      if (process.env.AUTH_PASSWORD_ENABLED !== undefined || process.env.AUTH_PASSWORD_RECOVERY !== undefined) {
        throw new Response('password authentication is controlled by the deployment environment', { status: 409 })
      }
      const config = integrationConfig(instance)
      if (!data.enabled) {
        const enabledProviders = instance.authCapabilities.socialProviders
        if (enabledProviders.length === 0)
          throw new Response('enable and test a social provider before disabling passwords', { status: 409 })
        const accounts = await instance.auth.api.listUserAccounts({ headers: getRequest().headers })
        if (!enabledProviders.some((provider) => accounts.some((account) => account.providerId === provider))) {
          throw new Response('link the current admin account to an enabled social provider before disabling passwords', { status: 409 })
        }
      }
      setStoredIntegrationConfig(deploymentSettings(instance.repository), { ...config, passwordEnabled: data.enabled })
      await resetApp()
      return { enabled: data.enabled }
    }),
  )

export const saveSocialProvider = createServerFn({ method: 'POST' })
  .validator(socialProviderSettingsSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      await admin(instance)
      const prefix = `AUTH_${data.provider.toUpperCase()}`
      if (process.env[`${prefix}_CLIENT_ID`] || process.env[`${prefix}_CLIENT_SECRET`]) {
        throw new Response(`${data.provider} is controlled by the deployment environment`, { status: 409 })
      }
      const config = integrationConfig(instance)
      const current = config[data.provider]
      const anotherEnabled = SOCIAL_AUTH_PROVIDERS.some((candidate) => candidate !== data.provider && config[candidate]?.enabled)
      if (current?.enabled && !instance.authCapabilities.password && !anotherEnabled) {
        throw new Response('enable password authentication before changing the only active social provider', { status: 409 })
      }
      const clientSecret = data.clientSecret || current?.clientSecret
      if (!clientSecret) throw new Response('client secret is required', { status: 400 })
      setStoredIntegrationConfig(deploymentSettings(instance.repository), {
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
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      await admin(instance)
      const prefix = `AUTH_${data.provider.toUpperCase()}`
      if (process.env[`${prefix}_CLIENT_ID`] || process.env[`${prefix}_CLIENT_SECRET`]) {
        throw new Response(`${data.provider} is controlled by the deployment environment`, { status: 409 })
      }
      const config = integrationConfig(instance)
      const provider = config[data.provider]
      if (!provider) throw new Response(`${data.provider} is not configured`, { status: 400 })
      if (data.enabled) {
        const accounts = await instance.auth.api.listUserAccounts({ headers: getRequest().headers })
        if (!accounts.some((account) => account.providerId === data.provider)) {
          throw new Response(`test ${data.provider} by linking the current admin account before enabling it`, { status: 409 })
        }
      } else if (!instance.authCapabilities.password) {
        const remaining = SOCIAL_AUTH_PROVIDERS.some((candidate) => candidate !== data.provider && config[candidate]?.enabled)
        if (!remaining) throw new Response('cannot disable the last active authentication method', { status: 409 })
      }
      setStoredIntegrationConfig(deploymentSettings(instance.repository), {
        ...config,
        [data.provider]: { ...provider, enabled: data.enabled },
      })
      await resetApp()
      return { provider: data.provider, enabled: data.enabled }
    }),
  )

export const saveSmtpSettings = createServerFn({ method: 'POST' })
  .validator(smtpEmailSettingsSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const identity = await admin(instance)
      if (process.env.SMTP_HOST) {
        throw new Response('SMTP is controlled by the deployment environment', { status: 409 })
      }
      const config = integrationConfig(instance)
      const current = resolveSmtpConfig(config, {})
      const smtp = { ...data, password: data.password || current?.password, testedAt: Date.now() }
      const delivery = buildEmailDelivery(smtp)!
      try {
        await delivery.verify()
        await delivery.send({
          to: identity.email,
          subject: 'PrintHub email is configured',
          text: 'Your PrintHub SMTP connection is configured and working.',
          html: '<p>Your PrintHub SMTP connection is configured and working.</p>',
        })
      } catch (error) {
        throw new Response(`SMTP verification failed: ${error instanceof Error ? error.message : 'unknown error'}`, { status: 400 })
      }
      setStoredIntegrationConfig(deploymentSettings(instance.repository), {
        ...config,
        smtp,
        email: undefined,
        emailTestedAt: undefined,
        emails: undefined,
      })
      await resetApp()
      return { configured: true }
    }),
  )

export const removeSmtpSettings = createServerFn({ method: 'POST' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    requireMutationOrigin()
    await admin(instance)
    if (process.env.SMTP_HOST) {
      throw new Response('SMTP is controlled by the deployment environment', { status: 409 })
    }
    const config = integrationConfig(instance)
    setStoredIntegrationConfig(deploymentSettings(instance.repository), {
      ...config,
      smtp: undefined,
      email: undefined,
      emailTestedAt: undefined,
      emails: undefined,
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
      return context.service.listRequests(context.identity, resolveBoardConfig(context.repository).privateRequests, filters)
    }),
  )

export const listPeople = createServerFn({ method: 'GET' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      const context = await workspaceContext(instance, data.workspaceSlug)
      // With private requests, requesters see no one else — not even names.
      if (context.identity.role !== 'admin' && resolveBoardConfig(context.repository).privateRequests) {
        return context.service.listPeople().filter((person) => person.id === context.identity.id)
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
      return context.repository.listUsers().map((account) => ({ ...account, image: userImage(account.email, account.image) }))
    }),
  )

export const listDeploymentUsers = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    await admin(instance)
    return instance.repository.listDeploymentUsers().map((account) => ({ ...account, image: userImage(account.email, account.image) }))
  }),
)

export const updateWorkspaceMemberRole = createServerFn({ method: 'POST' })
  .validator(z.object({ workspaceSlug: workspaceSlugSchema, userId: z.string().min(1), role: z.enum(['admin', 'member']) }))
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      context.repository.setWorkspaceMemberRole(data.userId, data.role)
      context.events.publish('user.created')
    }),
  )

export const removeWorkspaceMember = createServerFn({ method: 'POST' })
  .validator(z.object({ workspaceSlug: workspaceSlugSchema, userId: z.string().min(1) }))
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      if (context.identity.id === data.userId) throw new Response('you cannot remove yourself', { status: 409 })
      context.repository.removeWorkspaceMember(data.userId)
      context.events.publish('user.created')
    }),
  )

export const createInvite = createServerFn({ method: 'POST' })
  .validator(inWorkspace(createInviteSchema))
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const label = data.label?.trim() ?? ''
      if (data.email && !instance.emailDelivery) throw new Response('configure SMTP before emailing invitations', { status: 409 })
      // The raw token exists only in this response; the database keeps a hash.
      const token = crypto.randomBytes(32).toString('base64url')
      const id = crypto.randomUUID()
      context.repository.createInvite({
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
            subject: 'You are invited to PrintHub',
            text: `You have been invited to PrintHub. Create your account using this single-use link: ${url}\n\nThis link expires in seven days.`,
            html: `<p>You have been invited to PrintHub.</p><p><a href="${url}">Create your account</a></p><p>This single-use link expires in seven days.</p>`,
          })
        } catch (error) {
          context.repository.deleteInvite(id)
          throw new Response(`could not send invitation: ${error instanceof Error ? error.message : 'unknown error'}`, { status: 502 })
        }
      }
      return { token, emailed: Boolean(data.email) }
    }),
  )

export const listInvites = createServerFn({ method: 'GET' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      return context.repository.listInvites().filter((invite) => !invite.usedAt && invite.expiresAt > Date.now())
    }),
  )

export const revokeInvite = createServerFn({ method: 'POST' })
  .validator(inWorkspace(idSchema))
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      context.repository.deleteInvite(data.id)
    }),
  )

// Public: the accept page needs to know whether the link is still good
// before asking anyone to type anything.
export const inviteInfo = createServerFn({ method: 'GET' })
  .validator(inviteInfoSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      const workspaceSlug = instance.repository.workspaceSlugForInvite(hashInviteToken(data.token), Date.now())
      if (!workspaceSlug) {
        return { valid: false, signedIn: false, joined: false, auth: instance.authCapabilities }
      }
      const workspace = instance.repository.workspaceBySlug(workspaceSlug)!
      const context = await instance.publicWorkspace(workspaceSlug)
      const invite = context.repository.findInvite(hashInviteToken(data.token))
      const identity = await instance.identity(getRequest().headers)
      const joined = identity ? instance.repository.workspaceForUser(identity.id, workspaceSlug) !== undefined : false
      if (joined) await instance.setActiveWorkspace(workspace.id, getRequest().headers)
      return {
        valid: !!invite && !invite.usedAt && invite.expiresAt > Date.now(),
        signedIn: identity !== undefined,
        joined,
        auth: instance.authCapabilities,
      }
    }),
  )

export const beginProviderInvite = createServerFn({ method: 'POST' })
  .validator(beginProviderInviteSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const workspaceSlug = instance.repository.workspaceSlugForInvite(hashInviteToken(data.token), Date.now())
      if (!workspaceSlug) throw new Response('this invite link is no longer valid', { status: 410 })
      const context = await instance.publicWorkspace(workspaceSlug)
      const invite = context.repository.findInvite(hashInviteToken(data.token))
      if (!invite || invite.usedAt || invite.expiresAt <= Date.now())
        throw new Response('this invite link is no longer valid', { status: 410 })
      if (!instance.authCapabilities.socialProviders.includes(data.provider)) {
        throw new Response(`${data.provider} authentication is not enabled`, { status: 400 })
      }
      setCookie('printhub_invite', data.token, {
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
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const workspaceSlug = instance.repository.workspaceSlugForInvite(hashInviteToken(data.token), Date.now())
      if (!workspaceSlug) throw new Response('this invite link is no longer valid', { status: 410 })
      const workspace = instance.repository.workspaceBySlug(workspaceSlug)!
      const context = await instance.publicWorkspace(workspaceSlug)
      const tokenHash = hashInviteToken(data.token)
      const invite = context.repository.findInvite(tokenHash)
      if (!invite || invite.usedAt || invite.expiresAt <= Date.now())
        throw new Response('this invite link is no longer valid', { status: 410 })
      if (invite.recipientEmail && invite.recipientEmail !== data.email) {
        throw new Response('this invitation belongs to another email address', { status: 403 })
      }
      if (instance.repository.database.select({ id: user.id }).from(user).where(eq(user.email, data.email)).get()) {
        throw new Response('an account with this email already exists — sign in instead', { status: 409 })
      }

      const { withAuthInvite } = await import('./authInvite')
      const created = await withAuthInvite(data.token, () =>
        instance.auth.api.signUpEmail({
          body: { email: data.email, password: data.password, name: data.name },
          headers: getRequest().headers,
        }),
      )
      instance.repository.ensurePersonalWorkspace(created.user)
      return { workspaceId: workspace.id }
    }),
  )

export const acceptWorkspaceInvite = createServerFn({ method: 'POST' })
  .validator(inviteInfoSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const identity = await instance.requireIdentity(getRequest().headers)
      const workspaceSlug = instance.repository.workspaceSlugForInvite(hashInviteToken(data.token), Date.now())
      if (!workspaceSlug) throw new Response('this invite link is no longer valid', { status: 410 })
      const workspace = instance.repository.workspaceBySlug(workspaceSlug)!
      const context = await instance.publicWorkspace(workspaceSlug)
      const accepted = context.repository.acceptInviteForUser(hashInviteToken(data.token), Date.now(), identity)
      if (!accepted) throw new Response('this invite link is no longer valid', { status: 410 })
      await instance.setActiveWorkspace(workspace.id, getRequest().headers)
      context.events.publish('user.created')
      return { workspaceId: workspace.id }
    }),
  )

function maskStorage(config: StorageConfig) {
  return config.adapter === 's3' ? { ...config, secretAccessKey: '' } : config
}

function maskStorageMigration(migration: StorageMigration | undefined) {
  return migration ? { ...migration, source: maskStorage(migration.source), destination: maskStorage(migration.destination) } : undefined
}

function resolveStorageInput(data: StorageConfig, current: StorageConfig): StorageConfig {
  if (data.adapter === 'local') return { adapter: 'local', root: path.resolve(data.root) }
  if (data.adapter === 'dropbox' || data.adapter === 'google-drive' || data.adapter === 'onedrive') {
    const root = data.root.replace(/^\/+|\/+$/g, '')
    if (root.split('/').some((segment) => segment === '.' || segment === '..'))
      throw new Response('invalid cloud storage folder', { status: 400 })
    return { adapter: data.adapter, root }
  }
  const secretAccessKey = data.secretAccessKey || (current.adapter === 's3' ? current.secretAccessKey : '')
  if (!secretAccessKey) throw new Response('missing secret access key', { status: 400 })
  const prefix = data.prefix?.trim().replace(/^\/+|\/+$/g, '') ?? ''
  if (prefix.length > 200 || prefix.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Response('invalid prefix', { status: 400 })
  }
  return {
    adapter: 's3',
    endpoint: data.endpoint,
    region: data.region,
    bucket: data.bucket,
    prefix: prefix || undefined,
    accessKeyId: data.accessKeyId,
    secretAccessKey,
    forcePathStyle: data.forcePathStyle,
  }
}

function cloudProviderName(provider: 'dropbox' | 'google-drive' | 'onedrive') {
  return provider === 'dropbox' ? 'Dropbox' : provider === 'google-drive' ? 'Google Drive' : 'OneDrive'
}

export const getTelemetrySettings = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    if ((await me(instance)).role !== 'admin') throw new Response('forbidden', { status: 403 })
    return resolveTelemetryConfig(deploymentSettings(instance.repository))
  }),
)

export const updateTelemetrySettings = createServerFn({ method: 'POST' })
  .validator(telemetrySettingsSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      if ((await me(instance)).role !== 'admin') throw new Response('forbidden', { status: 403 })
      const config = { enabled: data.enabled }
      instance.repository.setDeploymentSetting('telemetry', config)
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
      const visualJobs = context.repository.listAssetGenerationJobs().map((job) => {
        const request = context.repository.getRequest(job.requestId)
        return { ...job, kind: job.stage, name: request?.name ?? 'Deleted model', fileName: request?.fileName }
      })
      const orientationJobs = context.repository.listOrientationAnalysisJobs().map((job) => {
        const request = context.repository.getRequest(job.requestId)
        return { ...job, kind: 'orientation' as const, name: request?.name ?? 'Deleted model', fileName: request?.fileName }
      })
      return {
        storage: context.storage.adapter,
        storageReady: context.storageReady,
        queue: context.assetQueue.stats(),
        backgroundJobs: [...visualJobs, ...orientationJobs].sort((first, second) => first.queuedAt - second.queuedAt),
        incompleteUploads: context.repository.incompleteUploadStats(Date.now()),
        storageCapacity,
      }
    }),
  )

export const getSystemDiagnostics = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    if (!(await me(instance)).deploymentAdmin) throw new Response('forbidden', { status: 403 })
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

export const updateBoardSettings = createServerFn({ method: 'POST' })
  .validator(inWorkspace(boardSettingsSchema))
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const current = resolveBoardConfig(context.repository)
      const config = {
        privateRequests: data.privateRequests ?? current.privateRequests,
        planningStrategy: data.planningStrategy ?? current.planningStrategy,
      }
      context.repository.setSetting('board', config)
      // Boards refetch over SSE so requesters' views update immediately.
      context.events.publish('board.changed')
      return config
    }),
  )

export const getStorageSettings = createServerFn({ method: 'GET' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      return maskStorage((await workspaceAdmin(instance, data.workspaceSlug)).storage)
    }),
  )

export const listStorageDirectories = createServerFn({ method: 'POST' })
  .validator(inWorkspace(storageDirectorySchema))
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      await workspaceAdmin(instance, data.workspaceSlug)
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
      return maskStorageMigration(context.storageMigration.status()) ?? null
    }),
  )

export const getCloudConnections = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    await admin(instance)
    const origin = new URL(getRequest().url).origin
    return {
      dropbox: publicDropboxConnection(deploymentSettings(instance.repository), origin),
      'google-drive': publicGoogleDriveConnection(deploymentSettings(instance.repository), origin),
      onedrive: publicOneDriveConnection(deploymentSettings(instance.repository), origin),
    }
  }),
)

export const beginCloudConnection = createServerFn({ method: 'POST' })
  .validator(cloudConnectionSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const identity = await admin(instance)
      const input = { clientId: data.clientId, clientSecret: data.clientSecret }
      const origin = new URL(getRequest().url).origin
      const url =
        data.provider === 'dropbox'
          ? beginDropboxAuthorization(deploymentSettings(instance.repository), input, identity.id, origin, data.returnTo)
          : data.provider === 'google-drive'
            ? beginGoogleDriveAuthorization(deploymentSettings(instance.repository), input, identity.id, origin, data.returnTo)
            : beginOneDriveAuthorization(deploymentSettings(instance.repository), input, identity.id, origin, data.returnTo)
      return {
        url,
      }
    }),
  )

export const removeCloudConnection = createServerFn({ method: 'POST' })
  .validator(cloudProviderSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      await admin(instance)
      const repositories = instance.repository.listWorkspaces().map((workspace) => instance.repository.scoped(workspace.id))
      if (repositories.some((repository) => resolveStorageConfig(repository).adapter === data.provider))
        throw new Response(`move storage away from ${cloudProviderName(data.provider)} before disconnecting it`, { status: 409 })
      if (repositories.some((repository) => repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING)?.state === 'running'))
        throw new Response('wait for the storage migration to finish', { status: 409 })
      if (data.provider === 'dropbox') disconnectDropbox(deploymentSettings(instance.repository))
      else if (data.provider === 'google-drive') disconnectGoogleDrive(deploymentSettings(instance.repository))
      else disconnectOneDrive(deploymentSettings(instance.repository))
    }),
  )

export const startStorageMigration = createServerFn({ method: 'POST' })
  .validator(inWorkspace(storageSettingsSchema))
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const migration = await context.storageMigration.start(resolveStorageInput(data, context.storage))
      return maskStorageMigration(migration)!
    }),
  )

export const retryStorageMigration = createServerFn({ method: 'POST' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      return maskStorageMigration(await context.storageMigration.retry())!
    }),
  )

export const cancelStorageMigration = createServerFn({ method: 'POST' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      let instance = await app()
      let context = await workspaceAdmin(instance, data.workspaceSlug)
      if (typeof context.storageMigration.cancel !== 'function') {
        await resetApp()
        instance = await app()
        context = await workspaceAdmin(instance, data.workspaceSlug)
      }
      requireMutationOrigin()
      return maskStorageMigration(context.storageMigration.cancel())!
    }),
  )

export const acknowledgeStorageMigration = createServerFn({ method: 'POST' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      if (['completed', 'cancelled'].includes(context.storageMigration.status()?.state ?? ''))
        context.repository.deleteSetting(STORAGE_MIGRATION_SETTING)
    }),
  )

export const updateStorageSettings = createServerFn({ method: 'POST' })
  .validator(inWorkspace(storageSettingsSchema))
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const context = await workspaceAdmin(instance, data.workspaceSlug)

      const config = resolveStorageInput(data, context.storage)

      if (
        context.repository.listRequests().length > 0 ||
        context.repository.listOperations().length > 0 ||
        context.repository.activeUploadIds(Date.now()).size > 0
      ) {
        throw new Response('storage can only be changed while the board is empty and no uploads are in flight', { status: 409 })
      }

      const candidate = buildAssetStore(config, context.repository, context.workspace.id)
      try {
        await candidate.initialize()
        await candidate.writable()
      } catch (error) {
        throw new Response(`storage is not reachable or not writable: ${error instanceof Error ? error.message : 'unknown error'}`, {
          status: 400,
        })
      }

      context.repository.setSetting('storageEncrypted', encryptSetting(config))
      context.repository.deleteSetting('storage')
      // Publish before reset so current streams refetch and reconnect to the replacement bus.
      await resetApp()
      return maskStorage(config)
    }),
  )

export const moveCopies = createServerFn({ method: 'POST' })
  .validator(inWorkspace(moveCopiesSchema))
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const { workspaceSlug, ...input } = data
      const context = await workspaceContext(instance, workspaceSlug)
      return context.service.moveCopies(input, context.identity)
    }),
  )

export const reorderRequest = createServerFn({ method: 'POST' })
  .validator(inWorkspace(reorderRequestSchema))
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const context = await workspaceContext(instance, data.workspaceSlug)
      return context.service.reorder(data.id, data.status, data.order, context.identity)
    }),
  )

export const updateRequest = createServerFn({ method: 'POST' })
  .validator(inWorkspace(updateRequestSchema))
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const { id, workspaceSlug, ...fields } = data
      const context = await workspaceContext(instance, workspaceSlug)
      const { printTypeChanged } = context.service.update(id, fields, context.identity)
      if (printTypeChanged) context.assetQueue.enqueueAnalysis(id)
    }),
  )

export const deleteRequest = createServerFn({ method: 'POST' })
  .validator(inWorkspace(idSchema))
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const context = await workspaceContext(instance, data.workspaceSlug)
      return context.service.remove(data.id, context.identity)
    }),
  )
