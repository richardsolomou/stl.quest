import argon2 from 'argon2'
import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { admin, twoFactor } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import type { Database } from 'better-sqlite3'
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
  database: Database,
  secret: string,
  options?: {
    onUserCreated?: () => void
    onUserDeleting?: (userId: string) => Promise<void>
    claimInvite?: (token: string) => Invite | undefined
    completeInvite?: (id: string, userId: string) => void
    auth?: AuthAdapterConfig
    email?: EmailDelivery
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
  const countUsers = () => (database.prepare('SELECT count(*) count FROM "user"').get() as { count: number }).count
  return betterAuth({
    database,
    secret,
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
    // The appliance serves arbitrary hostnames, so the base URL is inferred
    // per request; CSRF holds because only the request's own origin is trusted.
    trustedOrigins: (request) => (request ? [new URL(request.url).origin] : []),
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
    // The first person to reach the empty instance claims the admin
    // account (appliance-style first run); signup closes after that.
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (countUsers() === 0) return { data: { ...user, role: 'admin' } }
            if (authProvisioningAllowed()) return { data: user }
            const invite = options?.claimInvite ? claimAuthInvite(options.claimInvite) : undefined
            if (!invite) throw new APIError('FORBIDDEN', { message: 'sign-up is by invitation' })
            return { data: { ...user, role: invite.role } }
          },
          after: async (user) => {
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
      // After first run, sign-up only proceeds when the request carries a
      // valid single-use invite token; the claim is atomic, so the invite is
      // consumed the moment it lets a sign-up through.
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
      admin({ ac: accessControl, roles: accessRoles, adminRoles: ['admin'], defaultRole: 'requester' }),
      twoFactor({ issuer: 'PrintHub', allowPasswordless: true }),
      tanstackStartCookies(),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
