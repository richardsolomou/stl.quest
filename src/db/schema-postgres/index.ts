import { account, invitation, member, organization, rateLimit, session, subscription, twoFactor, user, verification } from './auth'
import { assetGenerationJobs } from './analysis'
import {
  managedStorageAccounts,
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
  managedStorageAccounts,
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
  subscription,
  twoFactor,
  uploadSessions,
  user,
  verification,
}
