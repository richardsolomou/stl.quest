import { describe, expect, it, vi } from 'vitest'
import type { BoardConfig } from '../core/types'
import { authorizedRequestAsset, type RequestAssetContext } from './requestAssetAccess'

const request = { id: 'request', ownerUserId: 'owner' }

function context(role: 'admin' | 'requester', identityId: string, board: Partial<BoardConfig>) {
  return {
    identity: { id: identityId, role },
    service: { getRequest: vi.fn(async () => request) },
    repository: { getSetting: vi.fn(async () => board) },
  } as unknown as RequestAssetContext
}

describe('authorizedRequestAsset', () => {
  it('allows administrators to access private request assets', async () => {
    await expect(authorizedRequestAsset(context('admin', 'admin', { privateRequests: true }), 'request')).resolves.toBe(request)
  })

  it('hides another requester’s private assets', async () => {
    await expect(authorizedRequestAsset(context('requester', 'other', { privateRequests: true }), 'request')).resolves.toBeUndefined()
  })

  it('allows requesters to access public-board assets', async () => {
    await expect(authorizedRequestAsset(context('requester', 'other', { privateRequests: false }), 'request')).resolves.toBe(request)
  })

  it('hides assets from a member scoped to their own requests on a shared board', async () => {
    const scoped = context('requester', 'other', { privateRequests: false, memberVisibility: { other: 'own' } })
    await expect(authorizedRequestAsset(scoped, 'request')).resolves.toBeUndefined()
  })

  it('allows a member granted the whole board to access assets on a private board', async () => {
    const trusted = context('requester', 'other', { privateRequests: true, memberVisibility: { other: 'all' } })
    await expect(authorizedRequestAsset(trusted, 'request')).resolves.toBe(request)
  })

  it('still allows the owner of a scoped request to access their own assets', async () => {
    const owner = context('requester', 'owner', { privateRequests: false, memberVisibility: { owner: 'own' } })
    await expect(authorizedRequestAsset(owner, 'request')).resolves.toBe(request)
  })
})
