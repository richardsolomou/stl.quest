import { describe, expect, it } from 'vitest'
import { requestStageTotals, requestStatusSummaries, type RequestStatusItem } from './requestStatus'
import { workflow } from './workflow'

const request = (
  id: string,
  counts: Record<string, number>,
  createdAt: number,
  todoOrder?: number,
  upNextOrder?: number,
): RequestStatusItem => ({
  id,
  requesterId: 'me',
  createdAt,
  counts,
  orders: { todo: todoOrder, up_next: upNextOrder },
})

const rank = (summary: { ranks: { status: string; position: number; total: number }[] } | undefined, status: string) =>
  summary?.ranks.find((entry) => entry.status === status)

const statuses = workflow.statuses

describe('request status summaries', () => {
  it('returns nothing for someone with no requests', () => {
    expect(requestStatusSummaries([], statuses)).toEqual([])
  })

  it('lists each stage holding copies in workflow order', () => {
    const [summary] = requestStatusSummaries([request('a', { done: 1, todo: 2, in_progress: 1 }, 10)], statuses)

    expect(summary.stages).toEqual([
      { status: 'todo', label: 'Queue', count: 2 },
      { status: 'in_progress', label: 'Printing', count: 1 },
      { status: 'done', label: 'Ready', count: 1 },
    ])
  })

  it('numbers a single queued request first in the queue', () => {
    const [summary] = requestStatusSummaries([request('a', { todo: 1 }, 10)], statuses)

    expect(rank(summary, 'todo')).toEqual({ status: 'todo', position: 1, total: 1 })
  })

  it('numbers queued requests by the requester priority the board uses', () => {
    const summaries = requestStatusSummaries(
      [request('newest', { todo: 1 }, 30), request('promoted', { todo: 1 }, 10, -100), request('middle', { todo: 1 }, 20)],
      statuses,
    )

    expect(summaries.map((summary) => [summary.request.id, rank(summary, 'todo')?.position])).toEqual([
      ['promoted', 1],
      ['newest', 2],
      ['middle', 3],
    ])
  })

  it('leaves the queue position out once no copy is waiting', () => {
    const [summary] = requestStatusSummaries([request('a', { in_progress: 1 }, 10)], statuses)

    expect(summary.ranks).toEqual([])
  })

  it('does not count requests that have left the queue when numbering the rest', () => {
    const summaries = requestStatusSummaries([request('printing', { in_progress: 1 }, 30), request('waiting', { todo: 1 }, 20)], statuses)

    expect(
      rank(
        summaries.find(({ request: item }) => item.id === 'waiting'),
        'todo',
      )?.position,
    ).toBe(1)
  })

  it('numbers up next requests by the requester priority the board uses', () => {
    const summaries = requestStatusSummaries(
      [
        request('newest', { up_next: 1 }, 30),
        request('promoted', { up_next: 1 }, 10, undefined, -100),
        request('middle', { up_next: 1 }, 20),
      ],
      statuses,
    )

    expect(summaries.map((summary) => [summary.request.id, rank(summary, 'up_next')])).toEqual([
      ['promoted', { status: 'up_next', position: 1, total: 3 }],
      ['newest', { status: 'up_next', position: 2, total: 3 }],
      ['middle', { status: 'up_next', position: 3, total: 3 }],
    ])
  })

  it('ranks queue and up next independently for a request split across both', () => {
    const [split] = requestStatusSummaries(
      [request('split', { todo: 1, up_next: 1 }, 10), request('queued', { todo: 1 }, 20, -100)],
      statuses,
    )

    expect(split.ranks).toEqual([
      { status: 'todo', position: 2, total: 2 },
      { status: 'up_next', position: 1, total: 1 },
    ])
  })

  it('does not rank stages after up next', () => {
    const [summary] = requestStatusSummaries([request('a', { in_progress: 1, post_processing: 1, done: 1 }, 10)], statuses)

    expect(summary.ranks).toEqual([])
  })

  it('puts the furthest-along request first', () => {
    const summaries = requestStatusSummaries(
      [request('queued', { todo: 1 }, 30), request('ready', { done: 1 }, 10), request('printing', { todo: 1, in_progress: 1 }, 20)],
      statuses,
    )

    expect(summaries.map(({ request: item }) => item.id)).toEqual(['ready', 'printing', 'queued'])
  })

  it('drops requests without any copies left on the board', () => {
    expect(requestStatusSummaries([request('empty', { todo: 0 }, 10)], statuses)).toEqual([])
  })
})

describe('request stage totals', () => {
  it('adds copies per stage across requests and skips empty stages', () => {
    const summaries = requestStatusSummaries([request('a', { todo: 2, done: 1 }, 10), request('b', { todo: 1 }, 20)], statuses)

    expect(requestStageTotals(summaries, statuses)).toEqual([
      { status: 'todo', label: 'Queue', count: 3 },
      { status: 'done', label: 'Ready', count: 1 },
    ])
  })
})
