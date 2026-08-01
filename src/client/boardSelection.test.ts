import { describe, expect, it } from 'vitest'
import type { PublicPrintRequest } from '../core/types'
import { boardBatchDeletions, boardBatchMoves, boardSelectedCopies, boardSelectionEntries, selectBoardRequest } from './boardSelection'

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

  it('keeps selection within one print group', () => {
    const initial = selectBoardRequest(null, 'todo', ids, 'one', {}, 'group-one')
    const grouped = selectBoardRequest(initial, 'todo', ids, 'two', { toggle: true }, 'group-one')
    const otherGroup = selectBoardRequest(grouped, 'todo', ids, 'three', { toggle: true }, 'group-two')

    expect([[...grouped!.ids], otherGroup]).toEqual([
      ['one', 'two'],
      { status: 'todo', groupId: 'group-two', ids: new Set(['three']), anchorId: 'three' },
    ])
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

  it('selects copies from the active print group', () => {
    const request = {
      id: 'one',
      counts: { todo: 4 },
      groups: [
        { id: 'group-one', status: 'todo', count: 3 },
        { id: 'group-two', status: 'todo', count: 1 },
      ],
    } as unknown as PublicPrintRequest
    const selection = { status: 'todo' as const, groupId: 'group-one', ids: new Set(['one']), anchorId: 'one' }

    expect(boardSelectionEntries([request], selection, (item) => item.counts)).toEqual([{ request, max: 3 }])
  })

  it('uses selected counts and falls back to each maximum', () => {
    const request = { id: 'one' } as PublicPrintRequest
    expect(boardSelectedCopies([{ request, max: 3 }], { one: 2 })).toEqual([{ request, count: 2 }])
  })

  it('builds move and delete payloads from the same selected copies', () => {
    const request = { id: 'one' } as PublicPrintRequest
    const entries = [{ request, max: 3 }]
    expect([boardBatchMoves(entries, 'todo', 'done', {}), boardBatchDeletions(entries, 'todo')]).toEqual([
      [{ id: 'one', from: 'todo', to: 'done', count: 3 }],
      [{ id: 'one', status: 'todo', count: 3 }],
    ])
  })

  it('keeps grouped deletions scoped to their group', () => {
    const request = { id: 'one' } as PublicPrintRequest
    expect(boardBatchDeletions([{ request, max: 2 }], 'todo', 'group-one')).toEqual([
      { id: 'one', status: 'todo', count: 2, groupId: 'group-one' },
    ])
  })
})
