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
        Response.json({ tag_name: 'v0.28.0', html_url: 'https://github.com/richardsolomou/stl.quest/releases/tag/v0.28.0' }),
      )
    const check = createReleaseChecker({ fetcher })

    await expect(check('0.27.2')).resolves.toEqual({
      latestVersion: '0.28.0',
      releaseUrl: 'https://github.com/richardsolomou/stl.quest/releases/tag/v0.28.0',
    })
    await check('0.27.2')

    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('fails closed when release discovery is unavailable', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }))
    const check = createReleaseChecker({ fetcher })

    await expect(check('0.27.2')).resolves.toBeNull()
  })

  it('keeps the last known update when a later check fails', async () => {
    let time = 0
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ tag_name: 'v0.28.0' }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
    const check = createReleaseChecker({ fetcher, now: () => time, cacheMs: 1_000 })

    await check('0.27.2')
    time = 1_000

    await expect(check('0.27.2')).resolves.toEqual(expect.objectContaining({ latestVersion: '0.28.0' }))
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('retries a failed check sooner than a successful one, with bounded backoff', async () => {
    let time = 0
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }))
    const check = createReleaseChecker({ fetcher, now: () => time, cacheMs: 1_000, retryMs: 100 })

    await check('0.27.2')
    time = 99
    await check('0.27.2')
    expect(fetcher).toHaveBeenCalledTimes(1)

    time = 100
    await check('0.27.2')
    expect(fetcher).toHaveBeenCalledTimes(2)

    time = 299
    await check('0.27.2')
    expect(fetcher).toHaveBeenCalledTimes(2)

    for (time = 300; fetcher.mock.calls.length < 6; time += 1_000) await check('0.27.2')
    time -= 1
    await check('0.27.2')
    expect(fetcher).toHaveBeenCalledTimes(6)

    time += 1
    await check('0.27.2')
    expect(fetcher).toHaveBeenCalledTimes(7)
  })

  it('waits for the GitHub rate limit reset, then recovers', async () => {
    let time = 0
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '0.5' } }))
      .mockResolvedValueOnce(Response.json({ tag_name: 'v0.28.0' }))
    const check = createReleaseChecker({ fetcher, now: () => time, cacheMs: 1_000, retryMs: 100 })

    await expect(check('0.27.2')).resolves.toBeNull()
    time = 499
    await check('0.27.2')
    expect(fetcher).toHaveBeenCalledTimes(1)

    time = 500
    await expect(check('0.27.2')).resolves.toEqual(expect.objectContaining({ latestVersion: '0.28.0' }))
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('honors Retry-After on a rate-limited response, capped at the success interval', async () => {
    let time = 0
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429, headers: { 'retry-after': '3600' } }))
    const check = createReleaseChecker({ fetcher, now: () => time, cacheMs: 1_000, retryMs: 100 })

    await check('0.27.2')
    time = 999
    await check('0.27.2')
    expect(fetcher).toHaveBeenCalledTimes(1)

    time = 1_000
    await check('0.27.2')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('identifies itself to GitHub', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ tag_name: 'v0.27.2' }))
    await createReleaseChecker({ fetcher })('0.27.2')

    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('user-agent')).toBe('STL-Quest/0.27.2')
  })
})
