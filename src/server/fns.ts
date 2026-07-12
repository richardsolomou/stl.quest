import crypto from 'node:crypto'
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setCookie } from '@tanstack/react-start/server'
import { resolveAuthAdapterConfig } from '../adapters/auth'
import { buildEmailDelivery, resolveSmtpConfig } from '../adapters/email'
import { app, buildAssetStore, hashInviteToken, resetApp, resolveBoardConfig, resolveTelemetryConfig } from './app'
import { workflow } from '../core/workflow'
import { SOCIAL_AUTH_PROVIDERS, type IntegrationConfig } from '../core/auth'
import type { StorageConfig } from '../core/types'
import { getStoredIntegrationConfig, publicIntegrationConfig, setStoredIntegrationConfig } from './integrations'
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
  storageSettingsSchema,
  telemetrySettingsSchema,
  updateRequestSchema,
} from './schemas'
import type { PlatePlannerDraft, PrinterProfile } from '../core/platePlanner'

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
  return getStoredIntegrationConfig(instance.repository) ?? { passwordEnabled: true }
}

export const sessionInfo = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    const identity = await instance.identity(getRequest().headers)
    return {
      identity,
      setupRequired: instance.repository.countUsers() === 0,
      storageConfigured: instance.repository.getSetting('storage') !== undefined,
      storageReady: instance.storageReady,
      telemetryEnabled: resolveTelemetryConfig(instance.repository).enabled,
      privateRequests: resolveBoardConfig(instance.repository).privateRequests,
      auth: instance.authCapabilities,
      email: instance.emailCapabilities,
      workflow,
    }
  }),
)

export const getPlatePlannerState = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    await admin(instance)
    return {
      profiles: instance.repository.getSetting<PrinterProfile[]>('plate-planner-profiles'),
      draft: instance.repository.getSetting<PlatePlannerDraft>('plate-planner-draft'),
      analyses: instance.repository.listPlateModelAnalyses(),
      analysisJobs: instance.repository.listOrientationAnalysisJobs(),
      queue: instance.assetQueue.stats(),
    }
  }),
)

export const savePlatePlannerProfiles = createServerFn({ method: 'POST' })
  .validator(printerProfilesSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      await admin(instance)
      instance.repository.setSetting('plate-planner-profiles', data.profiles)
      return { saved: true }
    }),
  )

export const savePlateModelAnalyses = createServerFn({ method: 'POST' })
  .validator(plateModelAnalysesSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      await admin(instance)
      instance.repository.upsertPlateModelAnalyses(data.analyses)
      return { saved: data.analyses.length }
    }),
  )

export const savePlatePlannerDraft = createServerFn({ method: 'POST' })
  .validator(platePlannerDraftSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      await admin(instance)
      instance.repository.setSetting('plate-planner-draft', data.draft)
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
    const stored = getStoredIntegrationConfig(instance.repository)
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
      setStoredIntegrationConfig(instance.repository, { ...config, passwordEnabled: data.enabled })
      instance.events.publish('settings.changed')
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
      setStoredIntegrationConfig(instance.repository, {
        ...config,
        [data.provider]: { enabled: false, clientId: data.clientId, clientSecret },
      })
      instance.events.publish('settings.changed')
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
      setStoredIntegrationConfig(instance.repository, { ...config, [data.provider]: { ...provider, enabled: data.enabled } })
      instance.events.publish('settings.changed')
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
      setStoredIntegrationConfig(instance.repository, { ...config, smtp, email: undefined, emailTestedAt: undefined, emails: undefined })
      instance.events.publish('settings.changed')
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
    setStoredIntegrationConfig(instance.repository, {
      ...config,
      smtp: undefined,
      email: undefined,
      emailTestedAt: undefined,
      emails: undefined,
    })
    instance.events.publish('settings.changed')
    await resetApp()
    return { configured: false }
  }),
)

export const listRequests = createServerFn({ method: 'GET' })
  .validator(requestFiltersSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      return instance.service.listRequests(await me(instance), resolveBoardConfig(instance.repository).privateRequests, data)
    }),
  )

export const listPeople = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    const identity = await me(instance)
    // With private requests, requesters see no one else — not even names.
    if (identity.role !== 'admin' && resolveBoardConfig(instance.repository).privateRequests) {
      return instance.service.listPeople().filter((person) => person.name === identity.name)
    }
    return instance.service.listPeople()
  }),
)

export const listUsers = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    if ((await me(instance)).role !== 'admin') throw new Response('forbidden', { status: 403 })
    return instance.repository.listUsers().map((user) => ({ ...user, image: userImage(user.email, user.image) }))
  }),
)

export const createInvite = createServerFn({ method: 'POST' })
  .validator(createInviteSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      if ((await me(instance)).role !== 'admin') throw new Response('forbidden', { status: 403 })
      const label = data.label?.trim() ?? ''
      if (data.email && !instance.emailDelivery) throw new Response('configure SMTP before emailing invitations', { status: 409 })
      // The raw token exists only in this response; the database keeps a hash.
      const token = crypto.randomBytes(32).toString('base64url')
      const id = crypto.randomUUID()
      instance.repository.createInvite({
        id,
        tokenHash: hashInviteToken(token),
        role: data.role,
        label: label || undefined,
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
          instance.repository.deleteInvite(id)
          throw new Response(`could not send invitation: ${error instanceof Error ? error.message : 'unknown error'}`, { status: 502 })
        }
      }
      return { token, emailed: Boolean(data.email) }
    }),
  )

export const listInvites = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    if ((await me(instance)).role !== 'admin') throw new Response('forbidden', { status: 403 })
    return instance.repository.listInvites().filter((invite) => !invite.usedAt && invite.expiresAt > Date.now())
  }),
)

export const revokeInvite = createServerFn({ method: 'POST' })
  .validator(idSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      if ((await me(instance)).role !== 'admin') throw new Response('forbidden', { status: 403 })
      instance.repository.deleteInvite(data.id)
    }),
  )

// Public: the accept page needs to know whether the link is still good
// before asking anyone to type anything.
export const inviteInfo = createServerFn({ method: 'GET' })
  .validator(inviteInfoSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      const invite = instance.repository.findInvite(hashInviteToken(data.token))
      return {
        valid: !!invite && !invite.usedAt && invite.expiresAt > Date.now(),
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
      const invite = instance.repository.findInvite(hashInviteToken(data.token))
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
      const tokenHash = hashInviteToken(data.token)
      const invite = instance.repository.findInvite(tokenHash)
      if (!invite || invite.usedAt || invite.expiresAt <= Date.now())
        throw new Response('this invite link is no longer valid', { status: 410 })
      if (instance.repository.listUsers().some((user) => user.email === data.email)) {
        throw new Response('an account with this email already exists — sign in instead', { status: 409 })
      }

      const { withAuthInvite } = await import('./authInvite')
      const created = await withAuthInvite(data.token, () =>
        instance.auth.api.signUpEmail({
          body: { email: data.email, password: data.password, name: data.name },
          headers: getRequest().headers,
        }),
      )
      if (invite.role === 'admin') {
        instance.repository.database.prepare('UPDATE "user" SET role=? WHERE id=?').run('admin', created.user.id)
      }
    }),
  )

function maskStorage(config: StorageConfig) {
  return config.adapter === 's3' ? { ...config, secretAccessKey: '' } : config
}

export const getTelemetrySettings = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    if ((await me(instance)).role !== 'admin') throw new Response('forbidden', { status: 403 })
    return resolveTelemetryConfig(instance.repository)
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
      instance.repository.setSetting('telemetry', config)
      instance.events.publish('settings.changed')
      return config
    }),
  )

export const getBoardSettings = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    if ((await me(instance)).role !== 'admin') throw new Response('forbidden', { status: 403 })
    return resolveBoardConfig(instance.repository)
  }),
)

export const getDiagnostics = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    if ((await me(instance)).role !== 'admin') throw new Response('forbidden', { status: 403 })
    const operations = await instance.refreshDiagnostics()
    const visualJobs = instance.repository.listAssetGenerationJobs().map((job) => {
      const request = instance.repository.getRequest(job.requestId)
      return { ...job, kind: job.stage, name: request?.name ?? 'Deleted model', fileName: request?.fileName }
    })
    const orientationJobs = instance.repository.listOrientationAnalysisJobs().map((job) => {
      const request = instance.repository.getRequest(job.requestId)
      return { ...job, kind: 'orientation' as const, name: request?.name ?? 'Deleted model', fileName: request?.fileName }
    })
    return {
      version: __APP_VERSION__,
      storage: instance.storage.adapter,
      storageReady: instance.storageReady,
      queue: instance.assetQueue.stats(),
      backgroundJobs: [...visualJobs, ...orientationJobs].sort((first, second) => first.queuedAt - second.queuedAt),
      authentication: {
        password: instance.authCapabilities.password,
        socialProviders: instance.authCapabilities.socialProviders,
        smtpConfigured: instance.emailCapabilities.configured,
      },
      incompleteUploads: instance.repository.incompleteUploadStats(Date.now()),
      ...operations,
    }
  }),
)

export const updateBoardSettings = createServerFn({ method: 'POST' })
  .validator(boardSettingsSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      if ((await me(instance)).role !== 'admin') throw new Response('forbidden', { status: 403 })
      const config = { privateRequests: data.privateRequests }
      instance.repository.setSetting('board', config)
      // Boards refetch over SSE so requesters' views update immediately.
      instance.events.publish('board.changed')
      return config
    }),
  )

export const getStorageSettings = createServerFn({ method: 'GET' }).handler(async () =>
  rpc(async () => {
    const instance = await app()
    if ((await me(instance)).role !== 'admin') throw new Response('forbidden', { status: 403 })
    return maskStorage(instance.storage)
  }),
)

export const updateStorageSettings = createServerFn({ method: 'POST' })
  .validator(storageSettingsSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      if ((await me(instance)).role !== 'admin') throw new Response('forbidden', { status: 403 })

      let config: StorageConfig
      if (data.adapter === 'local') {
        config = data
      } else {
        const current = instance.storage
        // A blank secret keeps the currently saved one so edits never echo it.
        const secretAccessKey = data.secretAccessKey || (current.adapter === 's3' ? current.secretAccessKey : '')
        if (!secretAccessKey) throw new Response('missing secret access key', { status: 400 })
        const prefix = data.prefix?.trim().replace(/^\/+|\/+$/g, '') ?? ''
        if (prefix.length > 200 || prefix.split('/').some((segment) => segment === '.' || segment === '..'))
          throw new Response('invalid prefix', { status: 400 })
        config = {
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

      if (
        instance.repository.listRequests().length > 0 ||
        instance.repository.listOperations().length > 0 ||
        instance.repository.activeUploadIds(Date.now()).size > 0
      ) {
        throw new Response('storage can only be changed while the board is empty and no uploads are in flight', { status: 409 })
      }

      const candidate = buildAssetStore(config)
      try {
        await candidate.initialize()
        await candidate.writable()
      } catch (error) {
        throw new Response(`storage is not reachable or not writable: ${error instanceof Error ? error.message : 'unknown error'}`, {
          status: 400,
        })
      }

      instance.repository.setSetting('storage', config)
      // Publish before reset so current streams refetch and reconnect to the replacement bus.
      instance.events.publish('settings.changed')
      await resetApp()
      return maskStorage(config)
    }),
  )

export const moveCopies = createServerFn({ method: 'POST' })
  .validator(moveCopiesSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      return instance.service.moveCopies(data, await me(instance))
    }),
  )

export const reorderRequest = createServerFn({ method: 'POST' })
  .validator(reorderRequestSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      return instance.service.reorder(data.id, data.status, data.order, await me(instance))
    }),
  )

export const updateRequest = createServerFn({ method: 'POST' })
  .validator(updateRequestSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      const { id, ...fields } = data
      instance.service.update(id, fields, await me(instance))
    }),
  )

export const deleteRequest = createServerFn({ method: 'POST' })
  .validator(idSchema)
  .handler(async ({ data }) =>
    rpc(async () => {
      const instance = await app()
      requireMutationOrigin()
      return instance.service.remove(data.id, await me(instance))
    }),
  )
