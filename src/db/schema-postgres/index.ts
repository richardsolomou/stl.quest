import {
  account,
  invitation,
  member,
  memberNotificationPreferences,
  organization,
  rateLimit,
  session,
  subscription,
  twoFactor,
  user,
  userOnboarding,
  verification,
  workspaceOnboarding,
} from './auth'
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
  usageEvents,
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
  memberNotificationPreferences,
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
  usageEvents,
  user,
  userOnboarding,
  verification,
  workspaceOnboarding,
}
