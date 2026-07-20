import { describe, expect, it } from 'vitest'
import { selectBoardRequest } from './boardSelection'

const ids = ['one', 'two', 'three', 'four']

describe('board selection', () => {
  it('selects a range from the anchor within one column', () => {
    const initial = selectBoardRequest(null, 'todo', ids, 'two')
    expect([...selectBoardRequest(initial, 'todo', ids, 'four', { range: true })!.ids]).toEqual(['two', 'three', 'four'])
  })

  it('toggles individual requests', () => {
    const initial = selectBoardRequest(null, 'todo', ids, 'one')
    expect([...selectBoardRequest(initial, 'todo', ids, 'three', { toggle: true })!.ids]).toEqual(['one', 'three'])
  })

  it('starts a new selection when another column is used', () => {
    const initial = selectBoardRequest(null, 'todo', ids, 'one')
    expect(selectBoardRequest(initial, 'done', ids, 'four')).toMatchObject({ status: 'done', anchorId: 'four' })
  })
})
