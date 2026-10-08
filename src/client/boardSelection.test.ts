import { describe, expect, it } from 'vitest'
import type { PublicPrintRequest } from '../core/types'
import {
  boardCohortId,
  boardCardSelection,
  boardBatchDeletions,
  boardBatchMoves,
  boardRequestSelected,
  boardSelectedCardIds,
  boardSelectedCopies,
  boardSelectedRequests,
  boardSelectedRequestIds,
  boardSelectionEntries,
  boardEditSelectionTags,
  boardSelectionTagState,
  boardTagItems,
  selectBoardColumn,
  selectBoardTag,
  selectBoardRequest,
  type BoardSelection,
} from './boardSelection'

const ids = ['one', 'two', 'three', 'four']
const cohort = (requestId: string, status = 'todo', groupId?: string) => boardCohortId(requestId, status, groupId)

describe('board selection', () => {
  it('selects every request in one column once', () => {
    const selection = selectBoardColumn(['one', 'two', 'one'], 'todo')!

    expect([[...selection.requestIds.values()], [...selection.statuses.values()]]).toEqual([
      ['one', 'two'],
      ['todo', 'todo'],
    ])
  })

  it('does not create a selection for an empty column', () => {
    expect(selectBoardColumn([], 'todo')).toBeNull()
  })

  it('keeps a whole-column selection ungrouped on grouped cards', () => {
    const selection = selectBoardColumn(['one', 'two'], 'todo')

    expect(boardCardSelection(selection, 'todo', 'one', cohort('one', 'todo', 'group-one'), ['group-one'])).toEqual({ selected: true })
  })

  it('preserves the group identity of a group selection', () => {
    const selection = selectBoardRequest(null, 'todo', ['one'], 'one', {}, 'group-one')

    expect(boardCardSelection(selection, 'todo', 'one', cohort('one', 'todo', 'group-one'), ['group-one'])).toEqual({
      selected: true,
      groupId: 'group-one',
    })
  })

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
        [cohort(request.id, 'todo', 'tag'), 'todo'],
        [cohort('matching', 'todo', 'tag'), 'todo'],
      ]),
      groupIds: new Map([
        [cohort(request.id, 'todo', 'tag'), 'tag'],
        [cohort('matching', 'todo', 'tag'), 'tag'],
      ]),
      anchorGroupId: 'tag',
    })
  })

  it('selects a range from the anchor within one column', () => {
    const initial = selectBoardRequest(null, 'todo', ids, 'two')
    expect([...selectBoardRequest(initial, 'todo', ids, 'four', { range: true })!.statuses]).toEqual([
      [cohort('two'), 'todo'],
      [cohort('three'), 'todo'],
      [cohort('four'), 'todo'],
    ])
  })

  it('toggles individual requests', () => {
    const initial = selectBoardRequest(null, 'todo', ids, 'one')
    expect([...selectBoardRequest(initial, 'todo', ids, 'three', { toggle: true })!.statuses]).toEqual([
      [cohort('one'), 'todo'],
      [cohort('three'), 'todo'],
    ])
  })

  it('deduplicates selected request cohorts without losing delete permissions', () => {
    const request = { id: 'one', canDelete: true } as PublicPrintRequest
    const other = { id: 'two', canDelete: false } as PublicPrintRequest

    expect(
      boardSelectedRequests([
        { request, status: 'todo', max: 1 },
        { request, status: 'todo', groupId: 'tag', max: 1 },
        { request: other, status: 'todo', max: 1 },
      ]),
    ).toEqual([request, other])
  })

  it('adds a request from another column to the selection', () => {
    const initial = selectBoardRequest(null, 'todo', ids, 'one')
    expect([...selectBoardRequest(initial, 'done', ids, 'four', { toggle: true })!.statuses]).toEqual([
      [cohort('one'), 'todo'],
      [cohort('four', 'done'), 'done'],
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

    expect(boardSelectedCardIds(selection, 'todo')).toEqual(new Set([cohort('one', 'todo', 'group-one')]))
  })

  it('selects requests from multiple print groups', () => {
    const initial = selectBoardRequest(null, 'todo', ids, 'one', {}, 'group-one')
    const grouped = selectBoardRequest(initial, 'todo', ids, 'two', { toggle: true }, 'group-one')
    const otherGroup = selectBoardRequest(grouped, 'todo', ids, 'three', { toggle: true }, 'group-two')

    expect([[...grouped!.statuses.keys()], otherGroup]).toEqual([
      [cohort('one', 'todo', 'group-one'), cohort('two', 'todo', 'group-one')],
      {
        statuses: new Map([
          [cohort('one', 'todo', 'group-one'), 'todo'],
          [cohort('two', 'todo', 'group-one'), 'todo'],
          [cohort('three', 'todo', 'group-two'), 'todo'],
        ]),
        groupIds: new Map([
          [cohort('one', 'todo', 'group-one'), 'group-one'],
          [cohort('two', 'todo', 'group-one'), 'group-one'],
          [cohort('three', 'todo', 'group-two'), 'group-two'],
        ]),
        requestIds: new Map([
          [cohort('one', 'todo', 'group-one'), 'one'],
          [cohort('two', 'todo', 'group-one'), 'two'],
          [cohort('three', 'todo', 'group-two'), 'three'],
        ]),
        anchorId: cohort('three', 'todo', 'group-two'),
        anchorStatus: 'todo',
        anchorGroupId: 'group-two',
      },
    ])
  })

  it('selects multiple cohorts from the same print independently', () => {
    const first = selectBoardRequest(null, 'todo', ['one'], 'one', {}, 'group-one')
    const both = selectBoardRequest(first, 'todo', ['one'], 'one', { toggle: true }, 'group-two')!

    expect([
      boardRequestSelected(both, 'todo', 'one', 'group-one'),
      boardRequestSelected(both, 'todo', 'one', 'group-two'),
      boardSelectedCardIds(both, 'todo'),
    ]).toEqual([true, true, new Set([cohort('one', 'todo', 'group-one'), cohort('one', 'todo', 'group-two')])])
  })

  it('selects every copy of a column regardless of tags', () => {
    const request = {
      id: 'one',
      counts: { todo: 4 },
      groups: [{ id: 'tag', status: 'todo', count: 3 }],
    } as unknown as PublicPrintRequest
    const selection = selectBoardColumn(['one'], 'todo')

    expect(
      boardSelectionEntries(
        [request],
        selection,
        (item) => item.counts,
        (item) => item.groups,
      ),
    ).toMatchObject([{ request, status: 'todo', max: 4 }])
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
      statuses: new Map([[cohort('one', 'todo', 'group-one'), 'todo']]),
      groupIds: new Map([[cohort('one', 'todo', 'group-one'), 'group-one']]),
      requestIds: new Map([[cohort('one', 'todo', 'group-one'), 'one']]),
      anchorId: cohort('one', 'todo', 'group-one'),
      anchorStatus: 'todo',
      anchorGroupId: 'group-one',
    }

    expect(
      boardSelectionEntries(
        [request],
        selection,
        (item) => item.counts,
        (item) => item.groups,
      ),
    ).toMatchObject([{ request, status: 'todo', groupId: 'group-one', max: 3 }])
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
        [cohort('one', 'todo', 'group-one'), 'todo'],
        [cohort('two', 'done'), 'done'],
      ]),
      new Map([[cohort('one', 'todo', 'group-one'), 'group-one']]),
    ])
  })

  it('keeps grouped deletions scoped to their group', () => {
    const request = { id: 'one' } as PublicPrintRequest
    expect(boardBatchDeletions([{ request, status: 'todo', groupId: 'group-one', max: 2 }])).toEqual([
      { id: 'one', status: 'todo', count: 2, groupId: 'group-one' },
    ])
  })

  it('builds one tag item per selected request and stage', () => {
    const request = { id: 'one', counts: { todo: 3, done: 1 } } as unknown as PublicPrintRequest
    const entries = [
      { request, status: 'todo', groupId: 'tag-a', cohorts: [{ key: 'a', count: 1, tagIds: ['tag-a'] }], max: 1 },
      { request, status: 'todo', groupId: 'tag-b', cohorts: [{ key: 'b', count: 1, tagIds: ['tag-b'] }], max: 1 },
      { request, status: 'done', cohorts: [{ key: 'done', count: 1, tagIds: [] }], max: 1 },
    ]

    expect(boardTagItems(entries)).toEqual([
      { requestId: 'one', status: 'todo', count: 2 },
      { requestId: 'one', status: 'done', count: 1 },
    ])
  })

  it('counts a card selected twice once', () => {
    const request = { id: 'one', counts: { todo: 3 } } as unknown as PublicPrintRequest
    const both = { key: 'both', count: 1, tagIds: ['tag-a', 'tag-b'] }
    const entries = [
      { request, status: 'todo', groupId: 'tag-a', cohorts: [{ key: 'a', count: 1, tagIds: ['tag-a'] }, both], max: 2 },
      { request, status: 'todo', cohorts: [both], max: 1 },
    ]

    expect(boardTagItems(entries)).toEqual([{ requestId: 'one', status: 'todo', count: 2 }])
  })

  it('leaves out selected copies that already carry the added tag', () => {
    const tagged = { id: 'one', counts: { todo: 4 } } as unknown as PublicPrintRequest
    const untagged = { id: 'two', counts: { todo: 1 } } as unknown as PublicPrintRequest
    const entries = [
      { request: tagged, status: 'todo', groupId: 'tag-a', cohorts: [{ key: 'a', count: 2, tagIds: ['tag-a'] }], max: 2 },
      { request: untagged, status: 'todo', cohorts: [{ key: 'two', count: 1, tagIds: [] }], max: 1 },
    ]

    expect(boardTagItems(entries, { tagId: 'tag-a', selected: true })).toEqual([{ requestId: 'two', status: 'todo', count: 1 }])
  })

  it('shows the tags every selected copy carries as on and the rest as partial', () => {
    const first = { id: 'one' } as PublicPrintRequest
    const second = { id: 'two' } as PublicPrintRequest

    expect(
      boardSelectionTagState([
        { request: first, status: 'todo', cohorts: [{ key: 'one', count: 1, tagIds: ['shared', 'partial'] }], max: 1 },
        { request: second, status: 'done', cohorts: [{ key: 'two', count: 1, tagIds: ['shared'] }], max: 1 },
      ]),
    ).toEqual({ all: new Set(['shared']), some: new Set(['partial']) })
  })

  it('applies a tag edit to every selected copy', () => {
    const request = { id: 'one' } as PublicPrintRequest
    const entries = [{ request, status: 'todo', cohorts: [{ key: 'one', count: 1, tagIds: ['old'] }], max: 1 }]

    expect(boardSelectionTagState(boardEditSelectionTags(boardEditSelectionTags(entries, 'new', true), 'old', false))).toEqual({
      all: new Set(['new']),
      some: new Set(),
    })
  })
})

describe('board selection of partly tagged prints', () => {
  const partlyTagged = {
    id: 'partly',
    counts: { todo: 3 },
    groups: [{ id: 'tag', status: 'todo', count: 2 }],
  } as unknown as PublicPrintRequest
  const tagged = {
    id: 'tagged',
    counts: { todo: 1 },
    groups: [{ id: 'tag', status: 'todo', count: 1 }],
  } as unknown as PublicPrintRequest
  const untaggedCard = () => selectBoardRequest(null, 'todo', ['partly'], 'partly', { toggle: true }, undefined, cohort('partly'))
  const bothCards = () =>
    selectBoardRequest(untaggedCard(), 'todo', ['tagged'], 'tagged', { toggle: true }, 'tag', cohort('tagged', 'todo', 'tag'))
  const entriesOf = (selection: BoardSelection | null) =>
    boardSelectionEntries(
      [partlyTagged, tagged],
      selection,
      (item) => item.counts,
      (item) => item.groups,
    )

  it('counts only the untagged copies of a selected untagged card', () => {
    expect(entriesOf(untaggedCard()).map(({ max }) => max)).toEqual([1])
  })

  it('shows a tag as partial when the selected untagged card lacks it', () => {
    expect(boardSelectionTagState(entriesOf(bothCards()))).toEqual({ all: new Set(), some: new Set(['tag']) })
  })

  it('removes a tag only from the selected copies that carry it', () => {
    expect(boardTagItems(entriesOf(bothCards()), { tagId: 'tag', selected: false })).toEqual([
      { requestId: 'tagged', status: 'todo', count: 1 },
    ])
  })

  it('adds a tag only to the selected copies without it', () => {
    expect(boardTagItems(entriesOf(bothCards()), { tagId: 'tag', selected: true })).toEqual([
      { requestId: 'partly', status: 'todo', count: 1 },
    ])
  })

  it('marks a selected untagged card of a partly tagged print as ungrouped', () => {
    expect(entriesOf(untaggedCard())[0].ungrouped).toBe(true)
  })

  it('selects only the card picked when other cards of the print carry tags', () => {
    expect(boardCardSelection(untaggedCard(), 'todo', 'partly', cohort('partly', 'todo', 'tag'), ['tag'])).toEqual({ selected: false })
  })
})
