import { account, invitation, member, organization, rateLimit, session, twoFactor, user, verification } from './auth'
import { assetGenerationJobs } from './analysis'
import {
  managedStorageEntitlements,
  managedStorageUsage,
  operations,
  printGroupItems,
  printGroups,
  requests,
  requestStatuses,
  uploadSessions,
} from './production'
import { assetMigrations, deploymentSettings, invites, settings } from './settings'

export * from './analysis'
export * from './auth'
export * from './production'
export * from './settings'

export const schema = {
  account,
  assetGenerationJobs,
  assetMigrations,
  deploymentSettings,
  invites,
  invitation,
  member,
  managedStorageUsage,
  managedStorageEntitlements,
  operations,
  printGroupItems,
  printGroups,
  organization,
  rateLimit,
  requests,
  requestStatuses,
  session,
  settings,
  twoFactor,
  uploadSessions,
  user,
  verification,
}
