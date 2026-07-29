import { describe, expect, it, vi } from 'vitest'
import { authorizedRequestAsset, type RequestAssetContext } from './requestAssetAccess'

const request = { id: 'request', ownerUserId: 'owner' }

function context(role: 'admin' | 'requester', identityId: string, privateRequests: boolean) {
  return {
    identity: { id: identityId, role },
    service: { getRequest: vi.fn(async () => request) },
    repository: { getSetting: vi.fn(async () => ({ privateRequests })) },
  } as unknown as RequestAssetContext
}

describe('authorizedRequestAsset', () => {
  it('allows administrators to access private request assets', async () => {
    await expect(authorizedRequestAsset(context('admin', 'admin', true), 'request')).resolves.toBe(request)
  })

  it('hides another requester’s private assets', async () => {
    await expect(authorizedRequestAsset(context('requester', 'other', true), 'request')).resolves.toBeUndefined()
  })

  it('allows requesters to access public-board assets', async () => {
    await expect(authorizedRequestAsset(context('requester', 'other', false), 'request')).resolves.toBe(request)
  })
})
