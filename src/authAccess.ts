import { createAccessControl } from 'better-auth/plugins/access'
import { adminAc, defaultStatements, userAc } from 'better-auth/plugins/admin/access'

export const accessControl = createAccessControl(defaultStatements)
export const accessRoles = { super_admin: adminAc, requester: userAc }
