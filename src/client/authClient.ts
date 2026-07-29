import { createAuthClient } from 'better-auth/react'
import { adminClient as superAdminClient, organizationClient, twoFactorClient } from 'better-auth/client/plugins'
import { stripeClient } from '@better-auth/stripe/client'
import { accessControl, accessRoles } from '../core/access'

export const authClient = createAuthClient({
  plugins: [
    superAdminClient({ ac: accessControl, roles: accessRoles }),
    organizationClient(),
    twoFactorClient(),
    stripeClient({ subscription: true }),
  ],
})
