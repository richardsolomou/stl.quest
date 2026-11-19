import { createAuthClient } from 'better-auth/react'
import { adminClient as superAdminClient, organizationClient, twoFactorClient } from 'better-auth/client/plugins'
import { stripeClient } from '@better-auth/stripe/client'
import { accessControl, accessRoles } from '../authAccess'
import { appPath } from '../basePath'

export const authClient = createAuthClient({
  basePath: appPath('/api/auth'),
  plugins: [
    superAdminClient({ ac: accessControl, roles: accessRoles }),
    organizationClient(),
    twoFactorClient(),
    stripeClient({ subscription: true }),
  ],
})
