import { createAuthClient } from 'better-auth/react'
import { adminClient, twoFactorClient } from 'better-auth/client/plugins'
import { accessControl, accessRoles } from '../core/access'

export const authClient = createAuthClient({
  plugins: [adminClient({ ac: accessControl, roles: accessRoles }), twoFactorClient()],
})
