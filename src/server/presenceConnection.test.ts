import { describe, expect, it, vi } from 'vitest'
import { presenceConnection } from './presenceConnection'

describe('presence connection', () => {
  it('leaves a presence join that completes after cancellation', () => {
    const release = vi.fn()
    const leave = vi.fn()
    const startHeartbeat = vi.fn()
    const connection = presenceConnection(release)

    connection.cleanup()
    connection.activate(leave, startHeartbeat)

    expect(leave).toHaveBeenCalledOnce()
    expect(startHeartbeat).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledOnce()
  })
})
