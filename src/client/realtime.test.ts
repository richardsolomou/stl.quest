import { EventEmitter } from 'node:events'
import type { Centrifuge } from 'centrifuge'
import { describe, expect, it, vi } from 'vitest'
import { watchWorkspaceUpdates } from './realtime'

describe('workspace realtime updates', () => {
  it('refreshes for workspace publications', () => {
    const client = new EventEmitter() as unknown as Centrifuge
    const refresh = vi.fn()
    watchWorkspaceUpdates(client, 'one', refresh)

    client.emit('publication', { channel: 'workspace:one', data: {} })
    client.emit('publication', { channel: 'workspace:two', data: {} })

    expect(refresh).toHaveBeenCalledOnce()
  })

  it('refreshes when a reconnect cannot recover its workspace stream', () => {
    const client = new EventEmitter() as unknown as Centrifuge
    const refresh = vi.fn()
    watchWorkspaceUpdates(client, 'one', refresh)

    client.emit('subscribed', {
      channel: 'workspace:one',
      recoverable: true,
      positioned: true,
      wasRecovering: true,
      recovered: false,
      hasRecoveredPublications: false,
    })

    expect(refresh).toHaveBeenCalledOnce()
  })

  it('does not refresh after successful recovery without missed publications', () => {
    const client = new EventEmitter() as unknown as Centrifuge
    const refresh = vi.fn()
    watchWorkspaceUpdates(client, 'one', refresh)

    client.emit('subscribed', {
      channel: 'workspace:one',
      recoverable: true,
      positioned: true,
      wasRecovering: true,
      recovered: true,
      hasRecoveredPublications: false,
    })

    expect(refresh).not.toHaveBeenCalled()
  })
})
