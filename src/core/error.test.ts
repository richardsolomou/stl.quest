import { describe, expect, it } from 'vitest'
import { errorMessage, isReportableMutationError, stlLoadErrorReason } from './error'
import { InvalidMeshError } from './mesh/stl'

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

describe('isReportableMutationError', () => {
  it('swallows a server-delivered rejection (the boundary collapses status/name/cause to a bare Error)', () => {
    // What every thrown Response arrives as on the client once shallow error serialization runs.
    expect(isReportableMutationError(new Error('cannot reduce below started copies'))).toBe(false)
    expect(isReportableMutationError(new Error('another operation is already running for this request'))).toBe(false)
  })

  it('reports a client-side transport fault', () => {
    expect(isReportableMutationError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isReportableMutationError(new DOMException('The operation was aborted.', 'AbortError'))).toBe(true)
  })

  it('reports an opaque fault that carries no message', () => {
    expect(isReportableMutationError(new Error(''))).toBe(true)
    expect(isReportableMutationError(new Error('   '))).toBe(true)
    expect(isReportableMutationError('boom')).toBe(true)
    expect(isReportableMutationError(undefined)).toBe(true)
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

  it('classifies a browser refusing a WebGL context as webgl_unavailable', () => {
    // three.js throws this exact message; the viewer's pre-fetch probe reuses the wording.
    expect(stlLoadErrorReason(new Error('THREE.WebGLRenderer: Error creating WebGL context.'))).toBe('webgl_unavailable')
  })

  it('classifies a rejected mesh file as invalid_mesh', () => {
    expect(stlLoadErrorReason(new InvalidMeshError('could not parse 3MF (unzip)'))).toBe('invalid_mesh')
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
