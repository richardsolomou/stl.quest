import { account, invitation, member, organization, rateLimit, session, twoFactor, user, verification } from './auth'
import { assetGenerationJobs } from './analysis'
import { operations, requests, requestStatuses, uploadSessions } from './production'
import { deploymentSettings, invites, settings } from './settings'

export * from './analysis'
export * from './auth'
export * from './production'
export * from './settings'

export const schema = {
  account,
  assetGenerationJobs,
  deploymentSettings,
  invites,
  invitation,
  member,
  operations,
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
