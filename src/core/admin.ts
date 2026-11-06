import type { Messages } from './i18n'
import { storagePlans, type StoragePlan } from './plans'
import type { Account, WorkspaceRole } from './types'

export type AdminWorkspaceOwner = {
  id: string
  name: string
  email: string
  image?: string
}

export type AdminWorkspace = {
  id: string
  name: string
  slug: string
  createdAt: number
  personal: boolean
  owners: AdminWorkspaceOwner[]
  memberCount: number
  requestCount: number
  copyCount: number
  lastRequestAt?: number
  printerCount: number
  storageConfigured: boolean
  managedStorage?: {
    ownerId: string
    usedBytes: number
    plan: StoragePlan
    quotaBytes: number
  }
  activeJobCount: number
  failedJobCount: number
}

export type AdminWorkspaceMember = {
  id: string
  name: string
  email: string
  image?: string
  role: WorkspaceRole
}

export type AdminWorkspaceDetails = AdminWorkspace & {
  members: AdminWorkspaceMember[]
  storageAdapter?: 'local' | 's3' | 'webdav' | 'dropbox' | 'google-drive' | 'onedrive' | 'box' | 'managed'
}

export type AdminAccountDetails = Account & {
  emailVerified: boolean
  twoFactorEnabled: boolean
  authProviders: string[]
  workspaces: Array<{
    id: string
    name: string
    slug: string
    role: WorkspaceRole
  }>
  managedStorage?: {
    plan: StoragePlan
    usedBytes: number
    quotaBytes: number
  }
  subscription?: {
    status: string
    periodEnd?: number
    trialEnd?: number
    cancelAt?: number
    cancelAtPeriodEnd: boolean
    billingInterval?: string
  }
}

type AttentionIssue = { kind: 'storageMissing' | 'storageFull' | 'storageNearlyFull' } | { kind: 'failedJobs'; count: number }

function attentionIssues(workspace: AdminWorkspace): AttentionIssue[] {
  const issues: AttentionIssue[] = []
  if (!workspace.storageConfigured) issues.push({ kind: 'storageMissing' })
  if (workspace.failedJobCount > 0) issues.push({ kind: 'failedJobs', count: workspace.failedJobCount })
  if (workspace.managedStorage) {
    const { usedBytes, quotaBytes } = workspace.managedStorage
    if (quotaBytes > 0 && usedBytes >= quotaBytes) issues.push({ kind: 'storageFull' })
    else if (quotaBytes > 0 && usedBytes / quotaBytes >= 0.9) issues.push({ kind: 'storageNearlyFull' })
  }
  return issues
}

export function adminWorkspaceAttentionReasons(workspace: AdminWorkspace, t: Messages['superAdmin']): string[] {
  return attentionIssues(workspace).map((issue) =>
    issue.kind === 'failedJobs' ? t.attention.failedJobs(issue.count) : t.attention[issue.kind],
  )
}

export function adminWorkspaceHealth(workspace: AdminWorkspace): 'healthy' | 'attention' {
  return attentionIssues(workspace).length ? 'attention' : 'healthy'
}

export function managedStorageSummary(plan: StoragePlan, usedBytes: number) {
  return { plan, usedBytes, quotaBytes: storagePlans[plan].quotaBytes }
}
