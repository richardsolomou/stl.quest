import { describe, expect, it } from 'vitest'
import type { PublicPrintRequest } from '../core/types'
import {
  boardBatchDeletions,
  boardBatchMoves,
  boardRequestSelected,
  boardSelectedCardIds,
  boardSelectedCopies,
  boardSelectedRequestIds,
  boardSelectionEntries,
  selectBoardTag,
  selectBoardRequest,
} from './boardSelection'

const ids = ['one', 'two', 'three', 'four']

describe('board selection', () => {
  it('selects every request carrying a tag in one stage', () => {
    const request = {
      id: 'request',
      groups: [{ id: 'tag', status: 'todo', count: 1 }],
    } as unknown as PublicPrintRequest
    const other = {
      ...request,
      id: 'other',
      groups: [{ ...request.groups[0], status: 'done' }],
    }
    const matching = { ...request, id: 'matching' }

    expect(selectBoardTag([request, matching, other], 'todo', 'tag')).toMatchObject({
      statuses: new Map([
        [request.id, 'todo'],
        ['matching', 'todo'],
      ]),
      groupIds: new Map([
        [request.id, 'tag'],
        ['matching', 'tag'],
      ]),
      anchorGroupId: 'tag',
    })
  })

  it('selects a range from the anchor within one column', () => {
    const initial = selectBoardRequest(null, 'todo', ids, 'two')
    expect([...selectBoardRequest(initial, 'todo', ids, 'four', { range: true })!.statuses]).toEqual([
      ['two', 'todo'],
      ['three', 'todo'],
      ['four', 'todo'],
    ])
  })

  it('toggles individual requests', () => {
    const initial = selectBoardRequest(null, 'todo', ids, 'one')
    expect([...selectBoardRequest(initial, 'todo', ids, 'three', { toggle: true })!.statuses]).toEqual([
      ['one', 'todo'],
      ['three', 'todo'],
    ])
  })

  it('adds a request from another column to the selection', () => {
    const initial = selectBoardRequest(null, 'todo', ids, 'one')
    expect([...selectBoardRequest(initial, 'done', ids, 'four', { toggle: true })!.statuses]).toEqual([
      ['one', 'todo'],
      ['four', 'done'],
    ])
  })

  it('marks a split request as selected only in its selected column', () => {
    const selection = selectBoardRequest(null, 'todo', ids, 'one')

    expect([boardSelectedRequestIds(selection, 'todo'), boardSelectedRequestIds(selection, 'done')]).toEqual([new Set(['one']), new Set()])
  })

  it('matches the exact grouped or ungrouped card selected', () => {
    const selection = selectBoardRequest(null, 'todo', ids, 'one', {}, 'group-one')

    expect([
      boardRequestSelected(selection, 'todo', 'one', 'group-one'),
      boardRequestSelected(selection, 'todo', 'one'),
      boardRequestSelected(selection, 'todo', 'one', 'group-two'),
    ]).toEqual([true, false, false])
  })

  it('keeps grouped requests visible as selected cards', () => {
    const selection = selectBoardRequest(null, 'todo', ids, 'one', {}, 'group-one')

    expect(boardSelectedCardIds(selection, 'todo')).toEqual(new Set(['one']))
  })

  it('selects requests from multiple print groups', () => {
    const initial = selectBoardRequest(null, 'todo', ids, 'one', {}, 'group-one')
    const grouped = selectBoardRequest(initial, 'todo', ids, 'two', { toggle: true }, 'group-one')
    const otherGroup = selectBoardRequest(grouped, 'todo', ids, 'three', { toggle: true }, 'group-two')

    expect([[...grouped!.statuses.keys()], otherGroup]).toEqual([
      ['one', 'two'],
      {
        statuses: new Map([
          ['one', 'todo'],
          ['two', 'todo'],
          ['three', 'todo'],
        ]),
        groupIds: new Map([
          ['one', 'group-one'],
          ['two', 'group-one'],
          ['three', 'group-two'],
        ]),
        anchorId: 'three',
        anchorStatus: 'todo',
        anchorGroupId: 'group-two',
      },
    ])
  })

  it('selects every copy regardless of tags', () => {
    const request = {
      id: 'one',
      counts: { todo: 4 },
      groups: [{ status: 'todo', count: 3 }],
    } as unknown as PublicPrintRequest
    const selection = { statuses: new Map([['one', 'todo']]), groupIds: new Map(), anchorId: 'one', anchorStatus: 'todo' }

    expect(boardSelectionEntries([request], selection, (item) => item.counts)).toEqual([{ request, status: 'todo', max: 4 }])
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
    const selection = {
      statuses: new Map([['one', 'todo']]),
      groupIds: new Map([['one', 'group-one']]),
      anchorId: 'one',
      anchorStatus: 'todo',
      anchorGroupId: 'group-one',
    }

    expect(boardSelectionEntries([request], selection, (item) => item.counts)).toEqual([
      { request, status: 'todo', groupId: 'group-one', max: 3 },
    ])
  })

  it('uses selected counts and falls back to each maximum', () => {
    const request = { id: 'one' } as PublicPrintRequest
    expect(boardSelectedCopies([{ request, status: 'todo', max: 3 }], { one: 2 })).toEqual([
      { request, status: 'todo', groupId: undefined, count: 2 },
    ])
  })

  it('builds move and delete payloads from the same selected copies', () => {
    const request = { id: 'one' } as PublicPrintRequest
    const entries = [{ request, status: 'todo', max: 3 }]
    expect([boardBatchMoves(entries, 'done', {}), boardBatchDeletions(entries)]).toEqual([
      [{ id: 'one', from: 'todo', to: 'done', count: 3 }],
      [{ id: 'one', status: 'todo', count: 3 }],
    ])
  })

  it('preserves each selected request status in batch payloads', () => {
    const first = { id: 'one' } as PublicPrintRequest
    const second = { id: 'two' } as PublicPrintRequest
    const entries = [
      { request: first, status: 'todo', max: 1 },
      { request: second, status: 'done', max: 2 },
    ]

    expect(boardBatchDeletions(entries)).toEqual([
      { id: 'one', status: 'todo', count: 1 },
      { id: 'two', status: 'done', count: 2 },
    ])
  })

  it('selects grouped and ungrouped requests together', () => {
    const grouped = selectBoardRequest(null, 'todo', ids, 'one', {}, 'group-one')
    const mixed = selectBoardRequest(grouped, 'done', ids, 'two', { toggle: true })!

    expect([mixed.statuses, mixed.groupIds]).toEqual([
      new Map([
        ['one', 'todo'],
        ['two', 'done'],
      ]),
      new Map([['one', 'group-one']]),
    ])
  })

  it('keeps grouped deletions scoped to their group', () => {
    const request = { id: 'one' } as PublicPrintRequest
    expect(boardBatchDeletions([{ request, status: 'todo', groupId: 'group-one', max: 2 }])).toEqual([
      { id: 'one', status: 'todo', count: 2, groupId: 'group-one' },
    ])
  })
})
