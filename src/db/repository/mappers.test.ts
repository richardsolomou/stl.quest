import { describe, expect, it } from 'vitest'
import { mapInvite, mapUserIdentity, parseOperationPayload } from './mappers'

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

describe('parseOperationPayload', () => {
  it('decodes persisted operation payloads', () => {
    const payload = {
      kind: 'move',
      requestId: 'request',
      fromStatus: 'todo',
      toStatus: 'done',
      count: 1,
      sourcePath: 'todo/model.stl',
      destinationPath: 'done/model.stl',
    }

    expect(parseOperationPayload(JSON.stringify(payload))).toEqual(payload)
  })
})

describe('mapUserIdentity', () => {
  it('maps nullable profile images to optional values', () => {
    expect(mapUserIdentity({ id: 'user', email: 'user@example.com', name: 'User', image: null })).toEqual({
      id: 'user',
      email: 'user@example.com',
      name: 'User',
    })
  })
})
