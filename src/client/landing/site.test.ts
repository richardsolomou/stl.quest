import { describe, expect, it } from 'vitest'
import { showsEnglishLandingPage, showsLanding } from './site'

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

describe('showsEnglishLandingPage', () => {
  const visitor = { hosted: true, identity: null }

  it('treats the hosted front door as an English landing page', () => {
    expect(showsEnglishLandingPage(visitor, '/')).toBe(true)
  })

  it('treats the hosted legal pages as English for a signed-in user', () => {
    expect(showsEnglishLandingPage({ hosted: true, identity: { id: 'user' } }, '/privacy')).toBe(true)
  })

  it('treats the home alias as an English landing page', () => {
    expect(showsEnglishLandingPage(visitor, '/home')).toBe(true)
  })

  it('leaves a signed-in hosted board in the user language', () => {
    expect(showsEnglishLandingPage({ hosted: true, identity: { id: 'user' } }, '/')).toBe(false)
  })

  it('leaves the self-hosted setup screen in the user language', () => {
    expect(showsEnglishLandingPage({ hosted: false, identity: null }, '/')).toBe(false)
  })

  it('leaves application pages in the user language', () => {
    expect(showsEnglishLandingPage(visitor, '/sign-in')).toBe(false)
  })
})
