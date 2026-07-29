import { describe, expect, it } from 'vitest'
import { errorMessage, stlLoadErrorReason } from './error'

describe('errorMessage', () => {
  it('returns an error message', () => {
    expect(errorMessage(new Error('Network unavailable'), 'Request failed.')).toBe('Network unavailable')
  })

  it('returns a message from non-Error response objects', () => {
    expect(errorMessage({ message: 'User already exists.' }, 'Could not create account.')).toBe('User already exists.')
  })

  it('returns the fallback when a message is unavailable', () => {
    expect(errorMessage({ status: 500 }, 'Request failed.')).toBe('Request failed.')
  })

  it('supports optional error details', () => {
    expect(errorMessage({ status: 500 }, undefined)).toBeUndefined()
  })
})

describe('stlLoadErrorReason', () => {
  it('swallows a browser-initiated navigation/reload abort', () => {
    expect(stlLoadErrorReason(new DOMException('The operation was aborted.', 'AbortError'))).toBeNull()
  })

  it('swallows a disposal abort with no explicit reason', () => {
    const controller = new AbortController()
    controller.abort()
    expect(stlLoadErrorReason(controller.signal.reason)).toBeNull()
  })

  it('reports the stall watchdog abort as a timeout', () => {
    expect(stlLoadErrorReason(new DOMException('model load stalled', 'TimeoutError'))).toBe('timeout')
  })

  it('reports a real load failure', () => {
    expect(stlLoadErrorReason(new Error('fetch failed: 500'))).toBe('load_failed')
    expect(stlLoadErrorReason(new Error('empty STL'))).toBe('load_failed')
  })

  it('treats a non-object error as a load failure', () => {
    expect(stlLoadErrorReason('boom')).toBe('load_failed')
    expect(stlLoadErrorReason(undefined)).toBe('load_failed')
  })
})
