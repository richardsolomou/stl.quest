import { describe, expect, it } from 'vitest'
import { boardViewers } from './boardPresence'

describe('board presence', () => {
  it('uses channel-scoped viewer information', () => {
    expect(
      boardViewers([
        {
          client: 'client',
          user: 'user',
          connInfo: { id: 'wrong', name: 'Connection' },
          chanInfo: { id: 'right', name: 'Channel' },
        },
      ]),
    ).toEqual([{ id: 'right', name: 'Channel' }])
  })
})
