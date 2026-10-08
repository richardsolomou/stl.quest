import { describe, expect, it } from 'vitest'
import { autoArchiveDue, validAutoArchiveDays } from './autoArchive'

const DAY = 24 * 60 * 60 * 1000
const now = Date.UTC(2026, 9, 8, 12)

function request(id: string, counts: Record<string, number>, completedAt?: number, archivedAt?: number) {
  return { id, counts, completedAt, archivedAt }
}

describe('autoArchiveDue', () => {
  it('returns nothing when there are no requests', () => {
    expect(autoArchiveDue([], 7, now)).toEqual([])
  })

  it('returns a request whose copies have all been Ready for longer than the configured days', () => {
    expect(autoArchiveDue([request('a', { todo: 0, done: 2 }, now - 8 * DAY)], 7, now)).toEqual(['a'])
  })

  it('returns every due request and skips the rest', () => {
    const requests = [
      request('due', { done: 1 }, now - 10 * DAY),
      request('recent', { done: 1 }, now - 2 * DAY),
      request('also-due', { done: 3 }, now - 30 * DAY),
    ]
    expect(autoArchiveDue(requests, 7, now)).toEqual(['due', 'also-due'])
  })

  it('archives on the boundary exactly', () => {
    expect(autoArchiveDue([request('a', { done: 1 }, now - 7 * DAY)], 7, now)).toEqual(['a'])
  })

  it('waits until the boundary has fully passed', () => {
    expect(autoArchiveDue([request('a', { done: 1 }, now - 7 * DAY + 1)], 7, now)).toEqual([])
  })

  it('skips a request with copies still in another stage', () => {
    expect(autoArchiveDue([request('a', { post_processing: 1, done: 1 }, now - 30 * DAY)], 7, now)).toEqual([])
  })

  it('skips a request with no Ready copies', () => {
    expect(autoArchiveDue([request('a', { todo: 1, done: 0 }, now - 30 * DAY)], 7, now)).toEqual([])
  })

  it('skips a request that is already archived', () => {
    expect(autoArchiveDue([request('a', { done: 1 }, now - 30 * DAY, now - DAY)], 7, now)).toEqual([])
  })

  it('skips a Ready request without a recorded Ready time', () => {
    expect(autoArchiveDue([request('a', { done: 1 })], 7, now)).toEqual([])
  })
})

describe('validAutoArchiveDays', () => {
  it.each([1, 30, 365])('accepts %s', (days) => {
    expect(validAutoArchiveDays(days)).toBe(true)
  })

  it.each([0, -1, 1.5, 366, '7', null, undefined])('rejects %s', (days) => {
    expect(validAutoArchiveDays(days)).toBe(false)
  })
})
