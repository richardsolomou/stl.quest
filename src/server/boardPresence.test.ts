import { describe, expect, it, vi } from 'vitest'
import type { Identity } from '../core/types'
import { BoardPresence } from './boardPresence'

const identity = (id: string, name: string): Identity => ({ id, name, email: `${id}@example.com`, role: 'requester' })

describe('BoardPresence', () => {
  it('publishes unique viewers and removes them after their last board tab closes', () => {
    const presence = new BoardPresence()
    const listener = vi.fn()
    const leaveAdmin = presence.join('workspace', identity('admin', 'Admin'), listener)
    const leaveFirstTab = presence.join('workspace', identity('member', 'Member'))
    const leaveSecondTab = presence.join('workspace', identity('member', 'Member'))

    expect(listener).toHaveBeenLastCalledWith([
      { id: 'admin', name: 'Admin', image: undefined },
      { id: 'member', name: 'Member', image: undefined },
    ])
    leaveFirstTab()
    expect(listener).toHaveBeenLastCalledWith([
      { id: 'admin', name: 'Admin', image: undefined },
      { id: 'member', name: 'Member', image: undefined },
    ])
    leaveSecondTab()
    expect(listener).toHaveBeenLastCalledWith([{ id: 'admin', name: 'Admin', image: undefined }])
    leaveAdmin()
  })

  it('isolates workspace rosters', () => {
    const presence = new BoardPresence()
    const listener = vi.fn()
    presence.join('one', identity('admin', 'Admin'), listener)
    presence.join('two', identity('other', 'Other'))

    expect(listener).toHaveBeenLastCalledWith([{ id: 'admin', name: 'Admin', image: undefined }])
  })
})
