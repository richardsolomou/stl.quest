import { beforeEach, describe, expect, it, vi } from 'vitest'
import { startSocialSignIn } from './socialSignIn'

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
