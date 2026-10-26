import { describe, expect, it } from 'vitest'
import { showsLanding } from './site'

describe('showsLanding', () => {
  it('greets a signed-out visitor to the hosted service', () => {
    expect(showsLanding({ hosted: true, identity: null })).toBe(true)
  })

  it('shows a signed-in hosted user their board', () => {
    expect(showsLanding({ hosted: true, identity: { id: 'user' } })).toBe(false)
  })

  it('keeps a self-hosted install on its sign-in and setup screen', () => {
    expect(showsLanding({ hosted: false, identity: null })).toBe(false)
  })
})
