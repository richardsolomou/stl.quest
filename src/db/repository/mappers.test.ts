import { describe, expect, it } from 'vitest'
import { mapInvite } from './mappers'

describe('mapInvite', () => {
  it('maps nullable database fields to optional domain fields', () => {
    expect(
      mapInvite({
        id: 'invite',
        workspaceId: 'workspace',
        tokenHash: 'token',
        role: 'requester',
        label: null,
        recipientEmail: null,
        createdAt: 1,
        expiresAt: 2,
        usedAt: null,
        usedBy: null,
      }),
    ).toEqual({ id: 'invite', role: 'requester', createdAt: 1, expiresAt: 2 })
  })
})
