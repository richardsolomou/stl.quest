import { afterEach, describe, expect, it, vi } from 'vitest'
import { createId } from './id'

describe('createId', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses the browser UUID implementation when available', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'native-id' })

    expect(createId()).toBe('native-id')
  })

  it('creates a UUID when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.set(Array.from({ length: 16 }, (_, index) => index))
        return bytes
      },
    })

    expect(createId()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
  })
})
