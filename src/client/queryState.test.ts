import { describe, expect, it, vi } from 'vitest'
import { queryErrorMessage, queryStateKind, retryQueries } from './queryState'

describe('query state', () => {
  it('preserves a useful query error', () => {
    expect(queryErrorMessage(new Error('Network unavailable'))).toBe('Network unavailable')
  })

  it('provides a fallback for rejected non-error values', () => {
    expect(queryErrorMessage(null)).toBe('The request failed. Check your connection and try again.')
  })

  it('shows a rejection while another required query is still pending', () => {
    expect(queryStateKind(true, new Error('Network unavailable'))).toBe('error')
  })

  it('retries every query required by a view', async () => {
    const first = vi.fn(async () => undefined)
    const second = vi.fn(async () => undefined)

    await retryQueries(first, second)

    expect([first.mock.calls.length, second.mock.calls.length]).toEqual([1, 1])
  })
})
