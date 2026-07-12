import { createAccessControl } from 'better-auth/plugins/access'
import { adminAc, defaultStatements, userAc } from 'better-auth/plugins/admin/access'

// Shared by the server auth config and the browser auth client so the admin
// plugin accepts PrintHub's role names on both sides.
export const accessControl = createAccessControl(defaultStatements)
export const accessRoles = { operator: adminAc, requester: userAc }
