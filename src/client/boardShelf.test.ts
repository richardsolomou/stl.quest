import { describe, expect, it } from 'vitest'
import { shelfByRequester } from './boardShelf'

const entry = (key: string, requesterId: string) => ({ key, request: { requesterId } })

describe('shelfByRequester', () => {
  it('gathers each requester’s entries in the order the requester first appears', () => {
    const groups = shelfByRequester([entry('a', 'sam'), entry('b', 'kim'), entry('c', 'sam')])
    expect(groups.map(({ requesterId, entries }) => [requesterId, entries.map(({ key }) => key)])).toEqual([
      ['sam', ['a', 'c']],
      ['kim', ['b']],
    ])
  })
})
