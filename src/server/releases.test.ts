import { describe, expect, it, vi } from 'vitest'
import { createReleaseChecker, isNewerVersion } from './releases'

describe('release updates', () => {
  it('compares stable semantic versions', () => {
    expect(isNewerVersion('0.28.0', '0.27.2')).toBe(true)
  })

  it('does not treat older or invalid releases as updates', () => {
    expect(isNewerVersion('v0.27.1', '0.27.2')).toBe(false)
    expect(isNewerVersion('next', '0.27.2')).toBe(false)
  })

  it('returns and caches a newer release', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ tag_name: 'v0.28.0', html_url: 'https://github.com/richardsolomou/printhub/releases/tag/v0.28.0' }),
      )
    const check = createReleaseChecker({ fetcher })

    await expect(check('0.27.2')).resolves.toEqual({
      latestVersion: '0.28.0',
      releaseUrl: 'https://github.com/richardsolomou/printhub/releases/tag/v0.28.0',
    })
    await check('0.27.2')

    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('fails closed when release discovery is unavailable', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }))
    const check = createReleaseChecker({ fetcher })

    await expect(check('0.27.2')).resolves.toBeNull()
  })
})
