import argon2 from 'argon2'
import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { admin } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import type { Database } from 'better-sqlite3'
import { accessControl, accessRoles } from '../lib/access'

export function createAuth(database: Database, secret: string, onUserCreated?: () => void) {
  const countUsers = () => (database.prepare('SELECT count(*) count FROM "user"').get() as { count: number }).count
  return betterAuth({
    database,
    secret,
    // The appliance serves arbitrary hostnames, so the base URL is inferred
    // per request; CSRF holds because only the request's own origin is trusted.
    trustedOrigins: (request) => (request ? [new URL(request.url).origin] : []),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 256,
      // Argon2id keeps every hash from earlier builds and the Convex importer valid.
      password: {
        hash: (password) => argon2.hash(password),
        verify: ({ hash, password }) => argon2.verify(hash, password),
      },
    },
    session: { expiresIn: 30 * 24 * 60 * 60 },
    user: { additionalFields: { color: { type: 'string', required: false, input: false } } },
    // The first person to reach the empty instance claims the operator
    // account (appliance-style first run); signup closes after that.
    databaseHooks: {
      user: {
        create: {
          before: async (user) => ({ data: { ...user, role: countUsers() === 0 ? 'operator' : ((user as { role?: string }).role ?? 'requester') } }),
          after: async () => onUserCreated?.(),
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/sign-up/email' && countUsers() > 0) {
          throw new APIError('FORBIDDEN', { message: 'setup complete' })
        }
      }),
    },
    plugins: [
      admin({ ac: accessControl, roles: accessRoles, adminRoles: ['operator'], defaultRole: 'requester' }),
      tanstackStartCookies(),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
