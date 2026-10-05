import { describe, expect, it } from 'vitest'
import { accountDeletionWorkspaces, workspaceSlug } from './workspaces'

describe('workspace identity', () => {
  it('creates a stable URL slug', () => {
    expect(workspaceSlug('  Café & Models  ')).toBe('cafe-models')
  })

  it('uses a fallback when the name has no slug characters', () => {
    expect(workspaceSlug('工作室')).toBe('workspace')
  })
})

describe('account deletion workspaces', () => {
  it('removes solo workspaces, blocks shared sole-owned workspaces, and keeps co-owned workspaces', () => {
    const solo = { id: 'solo', name: 'Solo', ownerCount: 1, memberCount: 1 }
    const shared = { id: 'shared', name: 'Shared', ownerCount: 1, memberCount: 3 }
    const coOwned = { id: 'co-owned', name: 'Co-owned', ownerCount: 2, memberCount: 2 }

    expect(accountDeletionWorkspaces([solo, shared, coOwned])).toEqual({ blocking: [shared], removed: [solo] })
  })
})
