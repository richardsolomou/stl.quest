import { describe, expect, it } from 'vitest'
import { faviconHref } from './favicon'

describe('faviconHref', () => {
  it('includes the application version to invalidate browser caches after upgrades', () => {
    expect(faviconHref('0.30.0')).toBe('/favicon.svg?v=0.30.0')
  })
})
