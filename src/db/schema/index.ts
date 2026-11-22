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
import { consumables, equipment, printers, stores, spoolmanConnections, spoolmanLinks, spoolmanSpools } from './inventory'
import {
  managedStorageAccounts,
  managedStorageEntitlements,
  managedStorageUsage,
  operations,
  plateItems,
  plates,
  printGroupItems,
  printGroups,
  requests,
  requestStatuses,
  uploadSessions,
  usageEvents,
} from './production'
import { assetMigrations, dataMigrations, deploymentSettings, invites, settings } from './settings'

export * from './analysis'
export * from './auth'
export * from './inventory'
export * from './production'
export * from './settings'

export const schema = {
  account,
  assetGenerationJobs,
  assetMigrations,
  consumables,
  dataMigrations,
  deploymentSettings,
  equipment,
  invites,
  invitation,
  member,
  memberNotificationPreferences,
  managedStorageAccounts,
  managedStorageUsage,
  managedStorageEntitlements,
  operations,
  plateItems,
  plates,
  printGroupItems,
  printGroups,
  printers,
  organization,
  rateLimit,
  requests,
  requestStatuses,
  session,
  settings,
  stores,
  spoolmanConnections,
  spoolmanLinks,
  spoolmanSpools,
  subscription,
  twoFactor,
  uploadSessions,
  usageEvents,
  user,
  userOnboarding,
  verification,
  workspaceOnboarding,
}
