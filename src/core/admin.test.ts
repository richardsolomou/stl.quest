import { describe, expect, it } from 'vitest'
import { adminWorkspaceAttentionReasons, adminWorkspaceHealth, type AdminWorkspace } from './admin'
import { messagesFor } from './i18n'

const t = messagesFor('en').superAdmin

function workspace(overrides: Partial<AdminWorkspace> = {}): AdminWorkspace {
  return {
    id: 'workspace',
    name: 'Workshop',
    slug: 'workshop',
    createdAt: 1,
    personal: false,
    owners: [],
    memberCount: 1,
    requestCount: 0,
    copyCount: 0,
    printerCount: 0,
    storageConfigured: true,
    activeJobCount: 0,
    failedJobCount: 0,
    ...overrides,
  }
}

describe('admin workspace health', () => {
  it('marks an ordinary configured workspace as healthy', () => {
    expect(adminWorkspaceHealth(workspace())).toBe('healthy')
    expect(adminWorkspaceAttentionReasons(workspace(), t)).toEqual([])
  })

  it('reports actionable storage and processing problems', () => {
    const result = workspace({
      storageConfigured: false,
      failedJobCount: 2,
      managedStorage: { ownerId: 'owner', plan: 'free', usedBytes: 950_000_000, quotaBytes: 1_000_000_000 },
    })

    expect(adminWorkspaceHealth(result)).toBe('attention')
    expect(adminWorkspaceAttentionReasons(result, t)).toEqual([
      'Storage is not configured',
      '2 failed background jobs',
      'Managed storage is over 90% full',
    ])
  })

  it('distinguishes a full allowance from one approaching capacity', () => {
    expect(
      adminWorkspaceAttentionReasons(
        workspace({ managedStorage: { ownerId: 'owner', plan: 'free', usedBytes: 1_000_000_000, quotaBytes: 1_000_000_000 } }),
        t,
      ),
    ).toEqual(['Managed storage is full'])
  })

  it('reports problems in the requested language', () => {
    expect(adminWorkspaceAttentionReasons(workspace({ failedJobCount: 1 }), messagesFor('fr').superAdmin)).toEqual([
      '1 tâche d’arrière-plan en échec',
    ])
  })
})
