import argon2 from 'argon2'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api'
import { admin as superAdminPlugin, organization, twoFactor } from 'better-auth/plugins'
import PQueue from 'p-queue'
import { and, eq, ne, sql } from 'drizzle-orm'
import type { STLQuestDatabase } from '../db'
import { account as accountTable, schema, user as userTable } from '../db/schema'
import { accessControl, accessRoles } from '../core/access'
import type { AuthAdapterConfig } from '../core/auth'
import { PASSWORD_MIN_LENGTH } from '../core/security'
import type { Invite } from '../core/types'
import type { EmailDelivery } from '../adapters/email'
import { authProvisioningAllowed, claimAuthInvite, claimedAuthInvite } from './authInvite'
import { hostedDeployment } from './hosted'
import { forwardedOrigin } from './sameOrigin'

function passwordFromMutation(path: string, body: unknown) {
  if (!body || typeof body !== 'object') return undefined
  const input = body as Record<string, unknown>
  if (path === '/sign-up/email' || path === '/admin/create-user') return input.password
  if (path === '/change-password' || path === '/reset-password' || path === '/admin/set-user-password') return input.newPassword
  return undefined
}

export function createAuth(
  database: STLQuestDatabase,
  secret: string,
  options?: {
    onUserCreated?: () => void
    onUserDeleting?: (userId: string) => Promise<void>
    claimInvite?: (token: string, email: string) => Invite | undefined
    completeInvite?: (id: string, userId: string) => void
    auth?: AuthAdapterConfig
    email?: EmailDelivery
    baseURL?: string
    trustedOrigins?: string[]
    onError?: (error: unknown) => void
  },
) {
  const accountMutationQueues = new Map<string, PQueue>()
  const auth = options?.auth ?? { password: true, passwordReset: true, socialProviders: [] }
  const providerOptions = (provider: (typeof auth.socialProviders)[number]) => {
    const config = options?.auth?.[provider]
    return config ? { ...config, enabled: true, disableImplicitSignUp: true } : undefined
  }
  const socialProviders = {
    ...(providerOptions('google') ? { google: providerOptions('google')! } : {}),
    ...(providerOptions('discord') ? { discord: providerOptions('discord')! } : {}),
  }
  const claimInitialSuperAdmin = () => {
    database.run(sql`
      UPDATE ${userTable}
      SET role = 'super_admin'
      WHERE id = (SELECT id FROM ${userTable} ORDER BY ${userTable.createdAt}, ${userTable.id} LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM ${userTable} WHERE role = 'super_admin')
    `)
  }
  const authInstance = betterAuth({
    database: drizzleAdapter(database, { provider: 'sqlite', schema }),
    secret,
    baseURL: options?.baseURL,
    advanced: { useSecureCookies: false },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 120,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 60, max: 5 },
        '/request-password-reset': { window: 60, max: 5 },
        '/admin/set-user-password': { window: 60, max: 10 },
      },
    },
    trustedOrigins:
      options?.trustedOrigins ??
      ((request) =>
        request ? [new URL(request.url).origin, forwardedOrigin(request)].filter((origin): origin is string => Boolean(origin)) : []),
    disabledPaths: ['/change-email', '/unlink-account'],
    onAPIError: {
      onError: (error) => {
        if (!isAPIError(error) || error.status === 'INTERNAL_SERVER_ERROR') options?.onError?.(error)
      },
    },
    emailAndPassword: {
      enabled: auth.password,
      minPasswordLength: 8,
      maxPasswordLength: 256,
      password: {
        hash: (password) => argon2.hash(password),
        verify: ({ hash, password }) => argon2.verify(hash, password),
      },
      sendResetPassword: options?.email
        ? async ({ user, url }) => {
            await options.email!.send({
              to: user.email,
              subject: 'Reset your STL Quest password',
              text: `Reset your STL Quest password using this link: ${url}\n\nThis link expires in one hour.`,
              html: `<p>Reset your STL Quest password using the link below.</p><p><a href="${url}">Reset password</a></p><p>This link expires in one hour.</p>`,
            })
          }
        : undefined,
    },
    emailVerification: options?.email
      ? {
          sendVerificationEmail: async ({ user, url }) => {
            await options.email!.send({
              to: user.email,
              subject: 'Verify your STL Quest email address',
              text: `Verify your STL Quest email address using this link: ${url}\n\nThis link expires in one hour.`,
              html: `<p>Verify your STL Quest email address using the link below.</p><p><a href="${url}">Verify email address</a></p><p>This link expires in one hour.</p>`,
            })
          },
        }
      : undefined,
    socialProviders,
    account: {
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: true,
        updateUserInfoOnLink: true,
      },
      encryptOAuthTokens: true,
    },
    session: { expiresIn: 30 * 24 * 60 * 60 },
    user: {
      additionalFields: { color: { type: 'string', required: false, input: false } },
      changeEmail: {
        enabled: true,
        updateEmailWithoutVerification: false,
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (authProvisioningAllowed()) return { data: user }
            if (options?.claimInvite) claimAuthInvite(options.claimInvite, user.email.toLowerCase())
            return { data: { ...user, role: 'requester' } }
          },
          after: async (user) => {
            if (!hostedDeployment()) claimInitialSuperAdmin()
            const invite = claimedAuthInvite()
            if (invite) options?.completeInvite?.(invite.id, user.id)
            options?.onUserCreated?.()
          },
        },
        delete: {
          before: async (user) => {
            await options?.onUserDeleting?.(user.id)
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/sign-in/social') {
          const provider = (ctx.body as { provider?: string } | undefined)?.provider
          if (!provider || !auth.socialProviders.includes(provider as (typeof auth.socialProviders)[number])) {
            throw new APIError('FORBIDDEN', { message: 'social provider is not enabled' })
          }
        }
        const password = passwordFromMutation(ctx.path, ctx.body)
        if (typeof password === 'string' && password.length < PASSWORD_MIN_LENGTH) {
          throw new APIError('BAD_REQUEST', { message: `password must be at least ${PASSWORD_MIN_LENGTH} characters` })
        }
      }),
    },
    plugins: [
      superAdminPlugin({
        ac: accessControl,
        roles: accessRoles,
        adminRoles: ['super_admin'],
        defaultRole: 'requester',
        allowImpersonatingAdmins: true,
        impersonationSessionDuration: 60 * 60,
      }),
      organization({
        creatorRole: 'owner',
        teams: { enabled: false },
        schema: {
          organization: {
            additionalFields: { personalOwnerId: { type: 'string', required: false, input: false, fieldName: 'personal_owner_id' } },
          },
        },
      }),
      twoFactor({ issuer: 'STL Quest', allowPasswordless: true }),
    ],
  })
  const serializeAccountMutation = async <T>(userId: string, mutation: () => Promise<T>) => {
    const queue = accountMutationQueues.get(userId) ?? new PQueue({ concurrency: 1 })
    accountMutationQueues.set(userId, queue)
    return queue.add(mutation).finally(() => {
      if (queue.pending === 0 && queue.size === 0) accountMutationQueues.delete(userId)
    })
  }
  return Object.assign(authInstance, {
    manageAccount: {
      changeEmail: async ({ headers, newEmail, password }: { headers: Headers; newEmail: string; password: string }) => {
        await authInstance.api.verifyPassword({ body: { password }, headers })
        return authInstance.api.changeEmail({ body: { newEmail, callbackURL: '/account' }, headers })
      },
      unlinkAccount: async ({ headers, providerId }: { headers: Headers; providerId: string }) => {
        const session = await authInstance.api.getSession({ headers })
        if (!session) throw new APIError('UNAUTHORIZED')
        return serializeAccountMutation(session.user.id, async () => {
          const target = database
            .select({ id: accountTable.id })
            .from(accountTable)
            .where(and(eq(accountTable.userId, session.user.id), eq(accountTable.providerId, providerId)))
            .get()
          if (!target) throw new APIError('BAD_REQUEST', { message: 'sign-in method not found' })
          const remaining = database
            .select({ providerId: accountTable.providerId })
            .from(accountTable)
            .where(and(eq(accountTable.userId, session.user.id), ne(accountTable.id, target.id)))
            .all()
          const usable = remaining.some(({ providerId: remainingProvider }) =>
            remainingProvider === 'credential'
              ? auth.password
              : auth.socialProviders.includes(remainingProvider as (typeof auth.socialProviders)[number]),
          )
          if (!usable) throw new APIError('BAD_REQUEST', { message: 'cannot remove the last enabled sign-in method' })
          return authInstance.api.unlinkAccount({ body: { providerId }, headers })
        })
      },
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
