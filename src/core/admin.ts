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

export function adminWorkspaceAttentionReasons(workspace: AdminWorkspace): string[] {
  const reasons: string[] = []
  if (!workspace.storageConfigured) reasons.push('Storage is not configured')
  if (workspace.failedJobCount > 0)
    reasons.push(`${workspace.failedJobCount} failed background ${workspace.failedJobCount === 1 ? 'job' : 'jobs'}`)
  if (workspace.managedStorage) {
    const { usedBytes, quotaBytes } = workspace.managedStorage
    if (quotaBytes > 0 && usedBytes >= quotaBytes) reasons.push('Managed storage is full')
    else if (quotaBytes > 0 && usedBytes / quotaBytes >= 0.9) reasons.push('Managed storage is over 90% full')
  }
  return reasons
}

export function adminWorkspaceHealth(workspace: AdminWorkspace): 'healthy' | 'attention' {
  return adminWorkspaceAttentionReasons(workspace).length ? 'attention' : 'healthy'
}

export function managedStorageSummary(plan: StoragePlan, usedBytes: number) {
  return { plan, usedBytes, quotaBytes: storagePlans[plan].quotaBytes }
}
