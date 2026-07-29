import { describe, expect, it } from 'vitest'
import type { PublicPrintRequest } from '../core/types'
import { boardSelectionEntries, selectBoardRequest } from './boardSelection'

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

  it('excludes grouped copies from batch operations', () => {
    const request = {
      id: 'one',
      counts: { todo: 4 },
      groups: [{ status: 'todo', count: 3 }],
    } as unknown as PublicPrintRequest
    const selection = { status: 'todo', ids: new Set(['one']), anchorId: 'one' }

    expect(boardSelectionEntries([request], selection, (item) => item.counts)).toEqual([{ request, max: 1 }])
  })
})
