import { describe, expect, it, vi } from 'vitest'
import { loadSourceImage, resolveSourceImage, sourceImageFailure } from './sourcePreview'

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

  it('reads MakerWorld metadata larger than a megabyte, as models with many print profiles return', async () => {
    const instances = Array.from({ length: 2_000 }, (_, index) => ({ id: index, title: 'Plate profile '.repeat(40) }))
    const metadata = JSON.stringify({ instances, coverUrl: 'https://makerworld.bblmw.com/makerworld/model/design/grip.jpg' })
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(metadata, { headers: { 'content-type': 'application/json' } }))
    expect(metadata.length).toBeGreaterThan(1024 * 1024)

    await expect(resolveSourceImage('https://makerworld.com/en/models/12702-bambu-scraper-grip#profileId-12703', request)).resolves.toBe(
      'https://makerworld.bblmw.com/makerworld/model/design/grip.jpg',
    )
  })

  it('stops reading MakerWorld metadata once the cover is in, since its API sometimes stalls partway through a large body', async () => {
    const head = new TextEncoder().encode('{"id":12702,"coverUrl":"https:\\/\\/makerworld.bblmw.com\\/grip.jpg","instances":[')
    const stalled = new ReadableStream<Uint8Array>({ start: (controller) => controller.enqueue(head) })
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(stalled))

    await expect(resolveSourceImage('https://makerworld.com/en/models/12702-bambu-scraper-grip', request)).resolves.toBe(
      'https://makerworld.bblmw.com/grip.jpg',
    )
  })

  it('still bounds MakerWorld metadata', async () => {
    const filler = JSON.stringify('x'.repeat(9 * 1024 * 1024))
    const metadata = `{"description":${filler},"coverUrl":"https://makerworld.bblmw.com/grip.jpg"}`
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(metadata))

    await expect(resolveSourceImage('https://makerworld.com/en/models/12702-bambu-scraper-grip', request)).resolves.toBeUndefined()
  })

  it('has no cover for sites that refuse every server request, without asking them', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(html('https://cdn.thingiverse.com/site/img/default/Thingiverse_Logo.png'))

    for (const link of [
      'https://www.thingiverse.com/thing:763622',
      'https://cults3d.com/en/3d-model/game/articulated-dragon-mcgybeer',
      'https://www.myminifactory.com/object/3d-print-dragon-107603',
      'https://thangs.com/designer/maker/3d-model/dragon-30573',
    ]) {
      await expect(resolveSourceImage(link, request)).resolves.toBeUndefined()
    }
    expect(request).not.toHaveBeenCalled()
  })

  it('refuses an image redirect that leaves the trusted CDNs', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }))

    await expect(loadSourceImage('https://media.printables.com/media/a/b.jpg', request)).rejects.toMatchObject({ status: 502 })
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

  it('asks the MakerWorld CDN for a resized cover, so a large original stays under the size limit', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])
    const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response(bytes))

    await loadSourceImage('https://makerworld.bblmw.com/makerworld/model/design/cover.jpg', request)
    await loadSourceImage('https://public-cdn.bblmw.com/design/cover.jpg?x-oss-process=image/resize,w_6000', request)
    await loadSourceImage('https://public-cdn.bambulab.com/design/cover.jpg', request)

    expect(request.mock.calls.map(([url]) => url)).toEqual([
      'https://makerworld.bblmw.com/makerworld/model/design/cover.jpg?x-oss-process=image%2Fresize%2Cw_1200',
      'https://public-cdn.bblmw.com/design/cover.jpg?x-oss-process=image%2Fresize%2Cw_1200',
      'https://public-cdn.bambulab.com/design/cover.jpg',
    ])
  })

  it('asks the Printables CDN for the rendition its gallery shows, so a large original stays under the size limit', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])
    const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response(bytes))

    await loadSourceImage('https://media.printables.com/media/prints/3161/images/20206_70fde6a0/benchy.jpg', request)
    await loadSourceImage('https://media.printables.com/media/prints/900000/images/6882786_b368/Storage-Box.PNG', request)

    expect(request.mock.calls.map(([url]) => url)).toEqual([
      'https://media.printables.com/media/prints/3161/images/20206_70fde6a0/thumbs/inside/1600x1200/jpg/benchy.webp',
      'https://media.printables.com/media/prints/900000/images/6882786_b368/thumbs/inside/1600x1200/PNG/Storage-Box.webp',
    ])
  })

  it('falls back to the original Printables image when the CDN has no rendition of it', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ message: 'No such object' }, { status: 400 }))
      .mockResolvedValueOnce(new Response(bytes))

    await expect(loadSourceImage('https://media.printables.com/media/prints/3161/images/20206/benchy.jpg', request)).resolves.toEqual({
      bytes,
      contentType: 'image/png',
    })
    expect(request).toHaveBeenLastCalledWith('https://media.printables.com/media/prints/3161/images/20206/benchy.jpg', expect.anything())
  })

  it('names the upstream status when a source image is unavailable', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('gone', { status: 404 }))

    await expect(loadSourceImage('https://media.printables.com/media/a/b.jpg', request)).rejects.toMatchObject({
      status: 502,
      statusText: 'source returned 404',
    })
  })

  it('names why a redirected source image was refused', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }))

    await expect(loadSourceImage('https://media.printables.com/media/a/b.jpg', request)).rejects.toMatchObject({
      statusText: 'source redirect refused',
    })
  })

  it('names a source that does not serve an image', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html></html>'))

    await expect(loadSourceImage('https://media.printables.com/media/a/b.jpg', request)).rejects.toMatchObject({
      statusText: 'source is not an image',
    })
  })

  it('names an oversized source image', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('x', { headers: { 'content-length': String(64 * 1024 * 1024) } }))

    await expect(loadSourceImage('https://media.printables.com/media/a/b.jpg', request)).rejects.toMatchObject({
      status: 413,
      statusText: 'source image is too large',
    })
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

describe('sourceImageFailure', () => {
  it('logs the status and reason of a refused source image', () => {
    expect(sourceImageFailure(new Response('source image unavailable', { status: 502, statusText: 'source returned 404' }))).toEqual({
      status: 502,
      details: { status: 502, reason: 'source returned 404' },
    })
  })

  it('logs an unexpected error as an error', () => {
    const error = new TypeError('fetch failed')

    expect(sourceImageFailure(error)).toEqual({ status: 502, details: { err: error } })
  })
})
