import { createAuthClient } from 'better-auth/react'
import { adminClient } from 'better-auth/client/plugins'
import { accessControl, accessRoles } from './access'

export const authClient = createAuthClient({ plugins: [adminClient({ ac: accessControl, roles: accessRoles })] })
