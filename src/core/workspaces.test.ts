import { describe, expect, it } from 'vitest'
import {
  accountDeletionWorkspaces,
  MAX_WORKSPACE_NAME_LENGTH,
  personalWorkspaceName,
  truncateWorkspaceName,
  workspaceSlug,
} from './workspaces'

describe('workspace identity', () => {
  it('creates a stable URL slug', () => {
    expect(workspaceSlug('  Café & Models  ')).toBe('cafe-models')
  })

  it('uses a fallback when the name has no slug characters', () => {
    expect(workspaceSlug('工作室')).toBe('workspace')
  })
})

describe('workspace names', () => {
  it('names a personal workspace after its owner', () => {
    expect(personalWorkspaceName('  Ada  ')).toBe("Ada's workspace")
  })

  it('names a personal workspace without an owner name generically', () => {
    expect(personalWorkspaceName('   ')).toBe('My workspace')
  })

  it('keeps a personal workspace named after a long user name within the limit', () => {
    expect(personalWorkspaceName('L'.repeat(300))).toBe(`${'L'.repeat(MAX_WORKSPACE_NAME_LENGTH - 12)}'s workspace`)
  })

  it('does not split a surrogate pair when shortening a name', () => {
    expect(truncateWorkspaceName(`${'a'.repeat(MAX_WORKSPACE_NAME_LENGTH - 1)}🦖`)).toBe('a'.repeat(MAX_WORKSPACE_NAME_LENGTH - 1))
  })
})

describe('account deletion workspaces', () => {
  it('removes solo workspaces, blocks shared sole-owned workspaces, and keeps co-owned workspaces', () => {
    const solo = { id: 'solo', name: 'Solo', ownerCount: 1, memberCount: 1 }
    const shared = { id: 'shared', name: 'Shared', ownerCount: 1, memberCount: 3 }
    const coOwned = { id: 'co-owned', name: 'Co-owned', ownerCount: 2, memberCount: 2 }

    expect(accountDeletionWorkspaces([solo, shared, coOwned])).toEqual({
      conflict: 'this user is the only owner of Shared. Remove the other members or delete that workspace first',
      removed: [solo],
    })
    expect(accountDeletionWorkspaces([solo, coOwned]).conflict).toBeUndefined()
  })
})
