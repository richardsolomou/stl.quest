import { describe, expect, it, vi } from 'vitest'
import { loadSourceImage, openGraphImage, resolveSourceImage } from './sourcePreview'

const html = (image: string) =>
  new Response(`<!doctype html><html><head><meta property="og:image" content="${image}"></head><body></body></html>`, {
    headers: { 'content-type': 'text/html' },
  })

describe('source previews', () => {
  it('resolves MakerWorld model covers through its public metadata endpoint', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ coverUrl: 'https://makerworld.bblmw.com/makerworld/model/design/cover.png' }))

    await expect(resolveSourceImage('https://makerworld.com/en/models/1172558-articulated-dragon', request)).resolves.toBe(
      'https://makerworld.bblmw.com/makerworld/model/design/cover.png',
    )
    expect(request).toHaveBeenCalledWith(
      'https://api.bambulab.com/v1/design-service/design/1172558',
      expect.objectContaining({ redirect: 'error' }),
    )
  })

  it('resolves Printables covers by joining the API file path onto its media host', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { print: { image: { filePath: 'media/a/b.jpg' } } } }))

    await expect(resolveSourceImage('https://www.printables.com/model/1113655-headband', request)).resolves.toBe(
      'https://media.printables.com/media/a/b.jpg',
    )
    expect(request).toHaveBeenCalledWith('https://api.printables.com/graphql/', expect.objectContaining({ method: 'POST' }))
  })

  it('resolves MyMiniFactory covers from the page OpenGraph tag', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(html('https://dl.myminifactory.com/object-assets/abc/images/720X720.jpg'))

    await expect(resolveSourceImage('https://www.myminifactory.com/object/3d-print-dragon-107603', request)).resolves.toBe(
      'https://dl.myminifactory.com/object-assets/abc/images/720X720.jpg',
    )
    expect(request).toHaveBeenCalledWith(
      'https://www.myminifactory.com/object/3d-print-dragon-107603',
      expect.objectContaining({ redirect: 'manual' }),
    )
  })

  it('resolves Cults3D covers from the page OpenGraph tag', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(html('https://images.cults3d.com/abc=/516x516/dragon.jpg'))

    await expect(resolveSourceImage('https://cults3d.com/en/3d-model/game/articulated-dragon', request)).resolves.toBe(
      'https://images.cults3d.com/abc=/516x516/dragon.jpg',
    )
  })

  it('resolves Thingiverse covers from the page OpenGraph tag', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(html('https://resize.thingiverse.com/?url=x&amp;w=628'))

    await expect(resolveSourceImage('https://www.thingiverse.com/thing:2810483', request)).resolves.toBe(
      'https://resize.thingiverse.com/?url=x&w=628',
    )
  })

  it('follows a canonicalising redirect that stays on the provider', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: 'https://cults3d.com/en/3d-model/art/dragon' } }))
      .mockResolvedValueOnce(html('https://images.cults3d.com/abc/dragon.jpg'))

    await expect(resolveSourceImage('https://cults3d.com/en/3d-model/game/dragon', request)).resolves.toBe(
      'https://images.cults3d.com/abc/dragon.jpg',
    )
    expect(request).toHaveBeenLastCalledWith('https://cults3d.com/en/3d-model/art/dragon', expect.objectContaining({ redirect: 'manual' }))
  })

  it('refuses a redirect that leaves the provider it started on', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://internal.example/admin' } }))
      .mockResolvedValueOnce(html('https://images.cults3d.com/abc/dragon.jpg'))

    await expect(resolveSourceImage('https://cults3d.com/en/3d-model/game/dragon', request)).resolves.toBeUndefined()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('refuses an image redirect that leaves the trusted CDNs', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }))

    await expect(loadSourceImage('https://media.printables.com/media/a/b.jpg', request)).rejects.toMatchObject({ status: 502 })
  })

  it('drops OpenGraph covers served from a host the proxy does not trust', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(html('https://internal.example/secret.png'))

    await expect(resolveSourceImage('https://cults3d.com/en/3d-model/game/dragon', request)).resolves.toBeUndefined()
  })

  it('ignores unrelated sources and lookalike hosts without making a request', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ coverUrl: 'https://internal.example/secret.png' }))

    await expect(resolveSourceImage('https://example.com/model', request)).resolves.toBeUndefined()
    await expect(resolveSourceImage('https://makerworld.com.evil.example/models/42', request)).resolves.toBeUndefined()
    await expect(resolveSourceImage('https://evil-printables.com/model/42', request)).resolves.toBeUndefined()
    await expect(resolveSourceImage('http://makerworld.com/models/42', request)).resolves.toBeUndefined()
    expect(request).not.toHaveBeenCalled()
  })

  it('ignores a known host whose path carries no model id', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ coverUrl: 'https://makerworld.bblmw.com/cover.png' }))

    await expect(resolveSourceImage('https://makerworld.com/en/@maker/collections', request)).resolves.toBeUndefined()
    await expect(resolveSourceImage('https://www.printables.com/search/models?q=dragon', request)).resolves.toBeUndefined()
    expect(request).not.toHaveBeenCalled()
  })

  it('loads only bounded images from trusted CDNs', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])
    const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response(bytes, { headers: { 'content-type': 'image/png' } }))

    await expect(loadSourceImage('https://makerworld.bblmw.com/model/cover.png', request)).resolves.toEqual({
      bytes,
      contentType: 'image/png',
    })
    await expect(loadSourceImage('https://media.printables.com/media/a/b.jpg', request)).resolves.toEqual({
      bytes,
      contentType: 'image/png',
    })
    await expect(loadSourceImage('https://example.com/cover.png', request)).rejects.toMatchObject({ status: 400 })
  })

  it('recognizes PNG covers served as generic binary data', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(bytes, {
        headers: { 'content-type': 'application/octet-stream' },
      }),
    )

    await expect(loadSourceImage('https://makerworld.bblmw.com/model/cover.png', request)).resolves.toEqual({
      bytes,
      contentType: 'image/png',
    })
  })
})

describe('OpenGraph image parsing', () => {
  it('reads the content value when it precedes the property attribute', () => {
    expect(openGraphImage(`<meta content='https://cdn.example/a.png' property='og:image'/>`)).toBe('https://cdn.example/a.png')
  })

  it('falls back to twitter:image when no og:image is present', () => {
    expect(openGraphImage('<meta name="twitter:image" content="https://cdn.example/b.png">')).toBe('https://cdn.example/b.png')
  })

  it('skips meta tags that only mention the image dimensions', () => {
    const head = '<meta property="og:image:width" content="720"><meta property="og:image" content="https://cdn.example/c.png">'
    expect(openGraphImage(head)).toBe('https://cdn.example/c.png')
  })

  it('returns nothing when the document declares no image', () => {
    expect(openGraphImage('<meta property="og:title" content="Dragon">')).toBeUndefined()
  })
})
