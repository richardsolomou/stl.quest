import argon2 from 'argon2'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { admin, organization, twoFactor } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { sql } from 'drizzle-orm'
import type { PrintHubDatabase } from '../db'
import { schema, user as userTable } from '../db/schema'
import { accessControl, accessRoles } from '../core/access'
import type { AuthAdapterConfig } from '../core/auth'
import { PASSWORD_MIN_LENGTH } from '../core/security'
import type { Invite } from '../core/types'
import type { EmailDelivery } from '../adapters/email'
import { authProvisioningAllowed, claimAuthInvite, claimedAuthInvite } from './authInvite'

function passwordFromMutation(path: string, body: unknown) {
  if (!body || typeof body !== 'object') return undefined
  const input = body as Record<string, unknown>
  if (path === '/sign-up/email' || path === '/admin/create-user') return input.password
  if (path === '/change-password' || path === '/reset-password' || path === '/admin/set-user-password') return input.newPassword
  return undefined
}

export function createAuth(
  database: PrintHubDatabase,
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
  },
) {
  const auth = options?.auth ?? { password: true, passwordReset: true, socialProviders: [] }
  const providerOptions = (provider: (typeof auth.socialProviders)[number]) => {
    const config = options?.auth?.[provider]
    return config ? { ...config, enabled: true, disableImplicitSignUp: true } : undefined
  }
  const socialProviders = {
    ...(providerOptions('google') ? { google: providerOptions('google')! } : {}),
    ...(providerOptions('discord') ? { discord: providerOptions('discord')! } : {}),
  }
  const claimInitialAdmin = () => {
    database.run(sql`
      UPDATE ${userTable}
      SET role = 'admin'
      WHERE id = (SELECT id FROM ${userTable} ORDER BY ${userTable.createdAt}, ${userTable.id} LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM ${userTable} WHERE role = 'admin')
    `)
  }
  return betterAuth({
    database: drizzleAdapter(database, { provider: 'sqlite', schema }),
    secret,
    baseURL: options?.baseURL,
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
    trustedOrigins: options?.trustedOrigins ?? ((request) => (request ? [new URL(request.url).origin] : [])),
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
              subject: 'Reset your PrintHub password',
              text: `Reset your PrintHub password using this link: ${url}\n\nThis link expires in one hour.`,
              html: `<p>Reset your PrintHub password using the link below.</p><p><a href="${url}">Reset password</a></p><p>This link expires in one hour.</p>`,
            })
          }
        : undefined,
    },
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
    user: { additionalFields: { color: { type: 'string', required: false, input: false } } },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (authProvisioningAllowed()) return { data: user }
            if (options?.claimInvite) claimAuthInvite(options.claimInvite, user.email.toLowerCase())
            return { data: { ...user, role: 'requester' } }
          },
          after: async (user) => {
            if (process.env.PRINTHUB_HOSTED !== 'true') claimInitialAdmin()
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
      admin({
        ac: accessControl,
        roles: accessRoles,
        adminRoles: ['admin'],
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
      twoFactor({ issuer: 'PrintHub', allowPasswordless: true }),
      tanstackStartCookies(),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
