import { describe, expect, it } from 'vitest'
import type { Identity } from './types'
import {
  memberRequestVisibility,
  normalizeBoardConfig,
  seesOnlyOwnRequests,
  visiblePeople,
  withMemberRequestVisibility,
} from './visibility'

const admin: Pick<Identity, 'id' | 'role'> = { id: 'admin', role: 'admin' }
const requester: Pick<Identity, 'id' | 'role'> = { id: 'requester', role: 'requester' }
const otherRequester: Pick<Identity, 'id' | 'role'> = { id: 'other-requester', role: 'requester' }

describe('board configuration', () => {
  it('reads a workspace that never set request visibility as shared', () => {
    expect(normalizeBoardConfig(undefined)).toEqual({ privateRequests: false, memberVisibility: {} })
  })

  it('keeps stored per-member overrides and drops unknown values', () => {
    const stored = { privateRequests: true, memberVisibility: { requester: 'all', broken: 'everything' } }
    expect(normalizeBoardConfig(stored as never)).toEqual({ privateRequests: true, memberVisibility: { requester: 'all' } })
  })
})

describe('member request visibility', () => {
  it('always shows administrators the whole board', () => {
    expect(memberRequestVisibility({ privateRequests: true, memberVisibility: { admin: 'own' } }, admin)).toBe('all')
  })

  it('follows the workspace default when the member has no override', () => {
    expect(memberRequestVisibility({ privateRequests: false, memberVisibility: {} }, requester)).toBe('all')
    expect(memberRequestVisibility({ privateRequests: true, memberVisibility: {} }, requester)).toBe('own')
  })

  it('scopes one member of a shared workspace to their own requests', () => {
    const config = { privateRequests: false, memberVisibility: { requester: 'own' as const } }
    expect(seesOnlyOwnRequests(config, requester)).toBe(true)
    expect(seesOnlyOwnRequests(config, otherRequester)).toBe(false)
  })

  it('opens the whole board to one member of a private workspace', () => {
    const config = { privateRequests: true, memberVisibility: { requester: 'all' as const } }
    expect(seesOnlyOwnRequests(config, requester)).toBe(false)
    expect(seesOnlyOwnRequests(config, otherRequester)).toBe(true)
  })
})

describe('people visible to a member', () => {
  const people = [{ id: 'requester' }, { id: 'other-requester' }]

  it('hides everyone else from a member scoped to their own requests', () => {
    expect(visiblePeople(people, { privateRequests: false, memberVisibility: { requester: 'own' } }, requester)).toEqual([
      { id: 'requester' },
    ])
  })

  it('keeps the workspace visible to members who see the whole board', () => {
    expect(visiblePeople(people, { privateRequests: true, memberVisibility: { requester: 'all' } }, requester)).toEqual(people)
  })
})

describe('changing a member override', () => {
  it('stores, replaces, and clears the override without touching the workspace default', () => {
    const shared = { privateRequests: true, memberVisibility: {} }
    const scoped = withMemberRequestVisibility(shared, 'requester', 'all')
    expect(scoped).toEqual({ privateRequests: true, memberVisibility: { requester: 'all' } })
    expect(withMemberRequestVisibility(scoped, 'requester', 'own').memberVisibility).toEqual({ requester: 'own' })
    expect(withMemberRequestVisibility(scoped, 'requester', 'default').memberVisibility).toEqual({})
    expect(shared.memberVisibility).toEqual({})
  })
})
