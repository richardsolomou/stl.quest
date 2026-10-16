import { gunzipSync } from 'node:zlib'
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { attachmentDisposition, gzipAssetStream, zipAssets } from './assetDownloads'

const bytes = (text: string) => new TextEncoder().encode(text)

/** A storage stream that never ends on its own, like a large S3 body the client stops reading. */
function endlessSource() {
  const state = { cancelled: false }
  const stream = new ReadableStream<Uint8Array>(
    {
      pull: (controller) => controller.enqueue(new Uint8Array(64 * 1024).fill(7)),
      cancel: () => {
        state.cancelled = true
      },
    },
    { highWaterMark: 1 },
  )
  return { stream, state }
}

/** Tracks how many storage reads are open at once. */
function trackedStore(contents: Record<string, string>) {
  const stats = { open: 0, maxOpen: 0, reads: [] as string[] }
  return {
    stats,
    read: async (path: string) => {
      stats.reads.push(path)
      stats.open++
      stats.maxOpen = Math.max(stats.maxOpen, stats.open)
      let sent = false
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent) {
            controller.close()
            stats.open--
            return
          }
          sent = true
          controller.enqueue(bytes(contents[path]))
        },
        cancel: () => {
          stats.open--
        },
      })
      return { stream, size: contents[path].length }
    },
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

describe('gzipAssetStream', () => {
  it('compresses the stored bytes', async () => {
    const source = new ReadableStream({ start: (controller) => (controller.enqueue(bytes('solid cube')), controller.close()) })

    const compressed = new Uint8Array(await new Response(gzipAssetStream(source)).arrayBuffer())

    expect(gunzipSync(compressed).toString()).toBe('solid cube')
  })

  it('cancels the storage stream when the client disconnects', async () => {
    const { stream, state } = endlessSource()
    const reader = gzipAssetStream(stream).getReader()
    await reader.read()

    await reader.cancel()
    await settle()

    expect(state.cancelled).toBe(true)
  })
})

describe('zipAssets', () => {
  it('archives every asset under its name', async () => {
    const store = trackedStore({ 'a.stl': 'first', 'b.stl': 'second' })

    const zip = new Uint8Array(
      await new Response(
        zipAssets(store, [
          { path: 'a.stl', name: 'one.stl' },
          { path: 'b.stl', name: 'two.stl' },
        ]),
      ).arrayBuffer(),
    )

    expect(Object.fromEntries(Object.entries(unzipSync(zip)).map(([name, data]) => [name, new TextDecoder().decode(data)]))).toEqual({
      'one.stl': 'first',
      'two.stl': 'second',
    })
  })

  it('holds at most one storage read open at a time', async () => {
    const entries = Array.from({ length: 60 }, (_, index) => ({ path: `${index}.stl`, name: `${index}.stl` }))
    const store = trackedStore(Object.fromEntries(entries.map(({ path }) => [path, path])))

    await new Response(zipAssets(store, entries)).arrayBuffer()

    expect(store.stats.maxOpen).toBe(1)
  })

  it('cancels the open storage stream and reads nothing more when the client disconnects', async () => {
    const first = endlessSource()
    const reads: string[] = []
    const store = {
      read: async (path: string) => {
        reads.push(path)
        return { stream: first.stream, size: 0 }
      },
    }
    const reader = zipAssets(store, [
      { path: 'a.stl', name: 'a.stl' },
      { path: 'b.stl', name: 'b.stl' },
    ]).getReader()
    await reader.read()

    await reader.cancel()
    await settle()

    expect({ cancelled: first.state.cancelled, reads }).toEqual({ cancelled: true, reads: ['a.stl'] })
  })

  it('fails the download when storage cannot read an asset', async () => {
    const store = {
      read: async () => {
        throw new Error('storage offline')
      },
    }

    await expect(new Response(zipAssets(store, [{ path: 'a.stl', name: 'a.stl' }])).arrayBuffer()).rejects.toThrow()
  })
})

describe('attachmentDisposition', () => {
  it.each(['昼.stl', 'dragon 🐉.3mf', 'café.obj', 'plain.stl'])('builds a valid header value for %s', (name) => {
    expect(() => new Headers({ 'Content-Disposition': attachmentDisposition(name) })).not.toThrow()
  })

  it('keeps the original name for browsers that read the extended parameter', () => {
    expect(attachmentDisposition('昼 "1".stl')).toContain(`filename*=UTF-8''${encodeURIComponent('昼 1.stl')}`)
  })

  it('keeps an ASCII name as the plain filename', () => {
    expect(attachmentDisposition('plain.stl')).toMatch(/^attachment; filename="plain\.stl"/)
  })

  it('strips header-breaking characters', () => {
    expect(attachmentDisposition('a"\r\nb.stl')).toMatch(/^attachment; filename="ab\.stl"/)
  })
})
