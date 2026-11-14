import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSocialSignInError, socialSignInErrorCode, startSocialSignIn } from './socialSignIn'

const social = vi.hoisted(() => vi.fn())
vi.mock('./authClient', () => ({ authClient: { signIn: { social } } }))

const options = { provider: 'github', callbackURL: '/' } as const

describe('social sign-in', () => {
  beforeEach(() => {
    social.mockReset()
  })

  it('reports a started redirect', async () => {
    social.mockResolvedValue({ data: { url: 'https://github.com/login', redirect: true }, error: null })

    await expect(startSocialSignIn(options)).resolves.toBe(true)
    expect(social).toHaveBeenCalledWith(options)
  })

  it('reports a failure that the server returns', async () => {
    social.mockResolvedValue({ data: null, error: { status: 400, message: 'Provider not found' } })

    await expect(startSocialSignIn(options)).resolves.toBe(false)
  })

  it('reports a failure when the browser cannot reach the server', async () => {
    social.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(startSocialSignIn(options)).resolves.toBe(false)
  })
})

describe('social sign-in callbacks', () => {
  it.each(['?error=access_denied', '?error=signup_disabled', '?error=unknown&error_description=private', '?error='])(
    'recognizes a failed callback without exposing its details: %s',
    (search) => {
      expect(hasSocialSignInError(search)).toBe(true)
    },
  )
  it.each(['', '?signup=true', '?error_description=private'])('does not report failure without an error parameter: %s', (search) => {
    expect(hasSocialSignInError(search)).toBe(false)
  })
})

describe('public social sign-in error codes', () => {
  it('shows a short error code without provider descriptions', () => {
    expect(socialSignInErrorCode('?error=signup_disabled&error_description=private')).toBe('signup_disabled')
  })
  it.each(['', '?error=', '?error=not%20a%20code', `?error=${'a'.repeat(101)}`])('does not show malformed error codes: %s', (search) => {
    expect(socialSignInErrorCode(search)).toBeUndefined()
  })
})
