import crypto from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setCookie } from '@tanstack/react-start/server'
import { resolveAuthAdapterConfig } from '../adapters/auth'
import { buildEmailDelivery, resolveSmtpConfig } from '../adapters/email'
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
import type { PrinterProfile, Repository, StorageConfig, StorageMigration } from '../core/types'
import { PRINTERS_SETTING, storedPrinterProfiles } from '../core/printers'
import { encryptSetting, getStoredIntegrationConfig, publicIntegrationConfig, setStoredIntegrationConfig } from './integrations'
import { requireMutationOrigin } from './mutationOrigin'
import { userImage } from './avatar'
import {
  acceptInviteSchema,
  boardSettingsSchema,
  beginProviderInviteSchema,
  changeOwnEmailSchema,
  createInviteSchema,
  deleteRequestsSchema,
  idSchema,
  inviteInfoSchema,
  moveCopiesSchema,
  moveCopiesBatchSchema,
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
  unlinkOwnAccountSchema,
  updateRequestSchema,
} from './schemas'
import { beginDropboxAuthorization, disconnectDropbox, publicDropboxConnection } from './dropboxConnection'
import { beginGoogleDriveAuthorization, disconnectGoogleDrive, publicGoogleDriveConnection } from './googleDriveConnection'
import { beginOneDriveAuthorization, disconnectOneDrive, publicOneDriveConnection } from './oneDriveConnection'
import { STORAGE_MIGRATION_SETTING } from './storageMigration'
import { systemDiagnostics } from './operations'
import { checkForReleaseUpdate } from './releases'
import { storageDirectories } from './storageDirectories'
import { assertStorageAllowed, hostedStorageRequiresRemote, localStorageAllowed, storageConfigured } from './storagePolicy'
import { hostedDeployment } from './hosted'

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
const superAdmin = async (instance: Awaited<ReturnType<typeof app>>) => {
  const identity = await me(instance)
  if (!identity.superAdmin) throw new Response('forbidden', { status: 403 })
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
      const printers = context ? storedPrinterProfiles(context.repository) : []
      const printersConfigured = context ? context.repository.getSetting<PrinterProfile[]>(PRINTERS_SETTING) !== undefined : false
      return {
        identity: context?.identity ?? identity,
        serverVersion: __APP_VERSION__,
        workspaces,
        workspace: context?.workspace,
        setupRequired: instance.repository.countUsers() === 0,
        storageConfigured: context ? storageConfigured(context.repository) : false,
        storageReady: context ? context.storageReady && !hostedStorageRequiresRemote(context.storage, context.repository) : false,
        localStorageAllowed: context ? localStorageAllowed(context.repository) : !hostedDeployment(),
        printersConfigured,
        printers,
        telemetryEnabled: resolveTelemetryConfig(deploymentSettings(instance.repository)).enabled,
        privateRequests: context ? resolveBoardConfig(context.repository).privateRequests : false,
        auth: instance.authCapabilities,
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
      return { profiles: storedPrinterProfiles(context.repository) }
    }),
  )

export const savePrinterProfiles = createServerFn({ method: 'POST' })
  .validator(inWorkspace(printerProfilesSchema))
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      context.repository.replacePrinterProfiles(data.profiles)
      context.events.publish('settings.changed')
      void instance.telemetry.capture(context.identity.id, 'printer_saved', { printer_count: data.profiles.length }).catch(() => undefined)
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
      const identity = await me(instance)
      if (!instance.authCapabilities.password) throw new Response('password authentication is disabled', { status: 409 })
      const accounts = await instance.auth.api.listUserAccounts({ headers: getRequest().headers })
      if (accounts.some((account) => account.providerId === 'credential')) {
        throw new Response('this account already has a password', { status: 409 })
      }
      await instance.auth.api.setPassword({ body: { newPassword: data.password }, headers: getRequest().headers })
      void instance.telemetry.capture(identity.id, 'sign_in_method_added', { provider: 'password' }).catch(() => undefined)
      return { configured: true }
    }),
  )

export const changeOwnEmail = createServerFn({ method: 'POST' })
  .validator(changeOwnEmailSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const identity = await me(instance)
      const accounts = await instance.auth.api.listUserAccounts({ headers: getRequest().headers })
      if (!accounts.some((account) => account.providerId === 'credential')) {
        throw new Response('create a password before changing your email address', { status: 409 })
      }
      await instance.auth.manageAccount.changeEmail({
        headers: getRequest().headers,
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
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const identity = await me(instance)
      await instance.auth.manageAccount.unlinkAccount({ headers: getRequest().headers, providerId: data.provider })
      void instance.telemetry.capture(identity.id, 'sign_in_method_removed', { provider: data.provider }).catch(() => undefined)
      return { removed: true }
    }),
  )

export const getIntegrationSettings = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    await superAdmin(instance)
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
      const identity = await superAdmin(instance)
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
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      await superAdmin(instance)
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
      const identity = await superAdmin(instance)
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
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const identity = await superAdmin(instance)
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
          subject: 'STL Quest email is configured',
          text: 'Your STL Quest SMTP connection is configured and working.',
          html: '<p>Your STL Quest SMTP connection is configured and working.</p>',
        })
      } catch (error) {
        throw new Response(`SMTP verification failed: ${error instanceof Error ? error.message : 'unknown error'}`, { status: 400 })
      }
      setStoredIntegrationConfig(deploymentSettings(instance.repository), {
        ...config,
        smtp,
      })
      void instance.telemetry.capture(identity.id, 'auth_provider_configured', { provider: 'smtp', enabled: true }).catch(() => undefined)
      await resetApp()
      return { configured: true }
    }),
  )

export const removeSmtpSettings = createServerFn({ method: 'POST' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    requireMutationOrigin()
    await superAdmin(instance)
    if (process.env.SMTP_HOST) {
      throw new Response('SMTP is controlled by the deployment environment', { status: 409 })
    }
    const config = integrationConfig(instance)
    setStoredIntegrationConfig(deploymentSettings(instance.repository), {
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

export const listAccounts = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    await superAdmin(instance)
    return instance.repository.listAccounts().map((account) => ({ ...account, image: userImage(account.email, account.image) }))
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
            subject: 'You are invited to STL Quest',
            text: `You have been invited to STL Quest. Create your account using this single-use link: ${url}\n\nThis link expires in seven days.`,
            html: `<p>You have been invited to STL Quest.</p><p><a href="${url}">Create your account</a></p><p>This single-use link expires in seven days.</p>`,
          })
        } catch (error) {
          context.repository.deleteInvite(id)
          throw new Response(`could not send invitation: ${error instanceof Error ? error.message : 'unknown error'}`, { status: 502 })
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
      if (instance.repository.accountExists(data.email)) {
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
      void instance.telemetry.capture(created.user.id, 'invite_accepted', {}).catch(() => undefined)
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
      void instance.telemetry.capture(identity.id, 'invite_accepted', {}).catch(() => undefined)
      return { workspaceId: workspace.id }
    }),
  )

function maskStorage(config: StorageConfig, repository?: Pick<Repository, 'isSuperAdminWorkspace'>) {
  if (repository && hostedStorageRequiresRemote(config, repository)) return { ...config, root: '' }
  if (config.adapter === 'webdav') return { ...config, password: '' }
  return config.adapter === 's3' ? { ...config, secretAccessKey: '' } : config
}

function maskStorageMigration(migration: StorageMigration | undefined, repository?: Pick<Repository, 'isSuperAdminWorkspace'>) {
  return migration
    ? { ...migration, source: maskStorage(migration.source, repository), destination: maskStorage(migration.destination, repository) }
    : undefined
}

function resolveStorageInput(data: StorageConfig, current: StorageConfig): StorageConfig {
  if (data.adapter === 'local') return { adapter: 'local', root: path.resolve(data.root) }
  if (data.adapter === 'dropbox' || data.adapter === 'google-drive' || data.adapter === 'onedrive') {
    const root = data.root.replace(/^\/+|\/+$/g, '')
    if (root.split('/').some((segment) => segment === '.' || segment === '..'))
      throw new Response('invalid cloud storage folder', { status: 400 })
    return { adapter: data.adapter, root }
  }
  if (data.adapter === 'webdav') {
    const password = data.password || (current.adapter === 'webdav' ? current.password : '')
    if (!password) throw new Response('missing WebDAV password', { status: 400 })
    const root = data.root.trim().replace(/^\/+|\/+$/g, '')
    if (root.split('/').some((segment) => segment === '.' || segment === '..')) throw new Response('invalid WebDAV folder', { status: 400 })
    return { adapter: 'webdav', endpoint: data.endpoint, root, username: data.username, password }
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

export function storageConfigChanged(current: StorageConfig, next: StorageConfig) {
  if (current.adapter !== next.adapter) return true
  if (current.adapter === 'local') return next.adapter !== 'local' || current.root !== next.root
  if (current.adapter === 'dropbox') return next.adapter !== 'dropbox' || current.root !== next.root
  if (current.adapter === 'google-drive') return next.adapter !== 'google-drive' || current.root !== next.root
  if (current.adapter === 'onedrive') return next.adapter !== 'onedrive' || current.root !== next.root
  if (current.adapter === 'webdav')
    return (
      next.adapter !== 'webdav' ||
      current.endpoint !== next.endpoint ||
      current.root !== next.root ||
      current.username !== next.username ||
      current.password !== next.password
    )
  return (
    next.adapter !== 's3' ||
    current.endpoint !== next.endpoint ||
    current.region !== next.region ||
    current.bucket !== next.bucket ||
    (current.prefix ?? '') !== (next.prefix ?? '') ||
    current.accessKeyId !== next.accessKeyId ||
    current.secretAccessKey !== next.secretAccessKey ||
    current.forcePathStyle !== next.forcePathStyle
  )
}

function cloudProviderName(provider: 'dropbox' | 'google-drive' | 'onedrive') {
  return provider === 'dropbox' ? 'Dropbox' : provider === 'google-drive' ? 'Google Drive' : 'OneDrive'
}

export const getTelemetrySettings = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    if (!(await me(instance)).superAdmin) throw new Response('forbidden', { status: 403 })
    return resolveTelemetryConfig(deploymentSettings(instance.repository))
  }),
)

export const updateTelemetrySettings = createServerFn({ method: 'POST' })
  .validator(telemetrySettingsSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      if (!(await me(instance)).superAdmin) throw new Response('forbidden', { status: 403 })
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
      return {
        storage: context.storage.adapter,
        storageReady: context.storageReady && !hostedStorageRequiresRemote(context.storage, context.repository),
        queue: context.assetQueue.stats(),
        backgroundJobs: visualJobs.sort((first, second) => first.queuedAt - second.queuedAt),
        incompleteUploads: context.repository.incompleteUploadStats(Date.now()),
        storageCapacity,
      }
    }),
  )

export const getSystemDiagnostics = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    if (!(await me(instance)).superAdmin) throw new Response('forbidden', { status: 403 })
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
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const current = resolveBoardConfig(context.repository)
      const config = {
        privateRequests: data.privateRequests ?? current.privateRequests,
      }
      context.repository.setSetting('board', config)
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
      return maskStorage(context.storage, context.repository)
    }),
  )

export const listStorageDirectories = createServerFn({ method: 'POST' })
  .validator(inWorkspace(storageDirectorySchema))
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      if (!localStorageAllowed(context.repository))
        throw new Response('server folders are limited to super admin workspaces', { status: 403 })
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
      return maskStorageMigration(context.storageMigration.status(), context.repository) ?? null
    }),
  )

export const getCloudConnections = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    const identity = await me(instance)
    const origin = new URL(getRequest().url).origin
    const connections = {
      dropbox: publicDropboxConnection(deploymentSettings(instance.repository), origin),
      'google-drive': publicGoogleDriveConnection(deploymentSettings(instance.repository), origin),
      onedrive: publicOneDriveConnection(deploymentSettings(instance.repository), origin),
    }
    if (identity.superAdmin) return connections
    return Object.fromEntries(
      Object.entries(connections).map(([provider, connection]) => [
        provider,
        {
          configured: connection.configured,
          connected: connection.connected,
          clientId: '',
          secretConfigured: false,
          callbackUrl: '',
        },
      ]),
    ) as typeof connections
  }),
)

export const beginCloudConnection = createServerFn({ method: 'POST' })
  .validator(cloudConnectionSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const identity = await superAdmin(instance)
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
      const identity = await superAdmin(instance)
      const repositories = instance.repository.listWorkspaces().map((workspace) => instance.repository.scoped(workspace.id))
      if (repositories.some((repository) => resolveStorageConfig(repository).adapter === data.provider))
        throw new Response(`move storage away from ${cloudProviderName(data.provider)} before disconnecting it`, { status: 409 })
      if (repositories.some((repository) => repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING)?.state === 'running'))
        throw new Response('wait for the storage migration to finish', { status: 409 })
      if (data.provider === 'dropbox') disconnectDropbox(deploymentSettings(instance.repository))
      else if (data.provider === 'google-drive') disconnectGoogleDrive(deploymentSettings(instance.repository))
      else disconnectOneDrive(deploymentSettings(instance.repository))
      void instance.telemetry.capture(identity.id, 'cloud_storage_disconnected', { provider: data.provider }).catch(() => undefined)
    }),
  )

export const startStorageMigration = createServerFn({ method: 'POST' })
  .validator(inWorkspace(storageSettingsSchema))
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const config = resolveStorageInput(data, context.storage)
      assertStorageAllowed(config, context.repository)
      const migration = await context.storageMigration.start(config)
      void instance.telemetry
        .capture(context.identity.id, 'storage_migration_started', { from: context.storage.adapter, to: config.adapter })
        .catch(() => undefined)
      return maskStorageMigration(migration, context.repository)!
    }),
  )

export const retryStorageMigration = createServerFn({ method: 'POST' })
  .validator(workspaceInputSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const context = await workspaceAdmin(instance, data.workspaceSlug)
      const migration = context.storageMigration.status()
      if (migration) assertStorageAllowed(migration.destination, context.repository)
      const retried = await context.storageMigration.retry()
      void instance.telemetry
        .capture(context.identity.id, 'storage_migration_retried', { adapter: retried.destination.adapter })
        .catch(() => undefined)
      return maskStorageMigration(retried, context.repository)!
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
      const cancelled = context.storageMigration.cancel()
      void instance.telemetry
        .capture(context.identity.id, 'storage_migration_cancelled', {
          adapter: cancelled.destination.adapter,
          files_copied: cancelled.copiedFiles,
        })
        .catch(() => undefined)
      return maskStorageMigration(cancelled, context.repository)!
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
      assertStorageAllowed(config, context.repository)

      const storageHasActivity =
        context.repository.listRequests().length > 0 ||
        context.repository.listOperations().length > 0 ||
        context.repository.activeUploadIds(Date.now()).size > 0
      if (storageHasActivity && storageConfigChanged(context.storage, config)) {
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
      void instance.telemetry.capture(context.identity.id, 'storage_configured', { adapter: config.adapter }).catch(() => undefined)
      // Publish before reset so current streams refetch and reconnect to the replacement bus.
      await resetApp()
      return maskStorage(config, context.repository)
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

export const moveCopiesBatch = createServerFn({ method: 'POST' })
  .validator(inWorkspace(moveCopiesBatchSchema))
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const context = await workspaceContext(instance, data.workspaceSlug)
      return context.service.moveCopiesBatch(data.moves, context.identity)
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
      context.service.update(id, fields, context.identity)
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

export const deleteRequests = createServerFn({ method: 'POST' })
  .validator(inWorkspace(deleteRequestsSchema))
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const context = await workspaceContext(instance, data.workspaceSlug)
      return context.service.removeBatch(data.ids, context.identity)
    }),
  )
