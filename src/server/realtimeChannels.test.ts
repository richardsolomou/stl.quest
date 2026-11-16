import { describe, expect, it } from 'vitest'
import type { RealtimeViewer } from './realtime'
import { channelPolicy } from './realtimeChannels'

const member: RealtimeViewer = { id: 'user-1', workspace: { id: 'workspace-1', slug: 'farm', boardPresence: true } }
const requester: RealtimeViewer = { ...member, workspace: { id: 'workspace-1', slug: 'farm', boardPresence: false } }

describe('channel policy', () => {
  it('subscribes a viewer to their workspace channel', () => {
    expect(channelPolicy.serverChannels(member)).toEqual(['workspace:workspace-1'])
  })

  it('gives a viewer outside any workspace no server-side channels', () => {
    expect(channelPolicy.serverChannels({ id: 'user-1' })).toEqual([])
  })

  it('lets a member who sees the whole board join its presence', () => {
    expect(channelPolicy.canSubscribe(member, 'board:farm')).toBe(true)
  })

  it('refuses another workspace’s board', () => {
    expect(channelPolicy.canSubscribe(member, 'board:another-farm')).toBe(false)
  })

  it('keeps a member who only sees their own requests off the board', () => {
    expect(channelPolicy.canSubscribe(requester, 'board:farm')).toBe(false)
  })
})
