import { describe, expect, it } from 'vitest'
import { clientNeedsRefresh } from './updateNotices'

describe('update notices', () => {
  it('requires a refresh when the browser and server versions differ', () => {
    expect(clientNeedsRefresh('0.28.0', '0.27.2')).toBe(true)
  })

  it('does not require a refresh for the current browser version', () => {
    expect(clientNeedsRefresh('0.27.2', '0.27.2')).toBe(false)
  })
})
