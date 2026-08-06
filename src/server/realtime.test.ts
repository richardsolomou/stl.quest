import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canSubscribeToBoard, connectionToken, subscriptionToken } from './realtime'

const identity = {
  id: 'user-1',
  name: 'Ada',
  email: 'ada@example.com',
  role: 'admin' as const,
  workspaceId: 'workspace-1',
}

function decode(token: string, secret: string) {
  const [header, payload, signature] = token.split('.')
  expect(signature).toBe(createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url'))
  return JSON.parse(Buffer.from(payload, 'base64url').toString())
}

describe('Centrifugo tokens', () => {
  it('subscribes a connection to its workspace channel', () => {
    expect(decode(connectionToken(identity, 'secret', 100), 'secret')).toEqual({
      sub: 'user-1',
      exp: 400,
      channels: ['workspace:workspace-1'],
    })
  })

  it('scopes viewer identity to one board subscription', () => {
    expect(decode(subscriptionToken(identity, 'board:one', 'secret', 100), 'secret')).toEqual({
      sub: 'user-1',
      channel: 'board:one',
      exp: 400,
      expire_at: 0,
      info: { id: 'user-1', name: 'Ada' },
    })
  })
})

describe('board subscription authorization', () => {
  it('allows the current workspace channel when requests are visible', () => {
    expect(canSubscribeToBoard({ role: 'requester' }, 'board:current', 'current', false)).toBe(true)
  })

  it('denies requesters when requests are private', () => {
    expect(canSubscribeToBoard({ role: 'requester' }, 'board:current', 'current', true)).toBe(false)
  })

  it('denies channels outside the current workspace', () => {
    expect(canSubscribeToBoard({ role: 'admin' }, 'board:other', 'current', false)).toBe(false)
  })
})
