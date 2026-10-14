import zlib from 'node:zlib'
import { PassThrough, Readable, pipeline } from 'node:stream'
import { ZipArchive } from 'archiver'
import type { AssetStore } from '../core/types'

type WebStream = Parameters<typeof Readable.fromWeb>[0]

// Storage streams hold a connection until they end or are cancelled, so every download here must cancel its
// source when the client disconnects; `.pipe()` alone would leave the source paused and the connection held.

export function gzipAssetStream(stream: ReadableStream): ReadableStream {
  // Mesh data gzips well; fastest level keeps NAS CPU cheap.
  const gzip = pipeline(Readable.fromWeb(stream as WebStream), zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED }), () => undefined)
  return Readable.toWeb(gzip) as ReadableStream
}

/** Opens each asset only after the previous one is archived, so a batch holds at most one storage connection. */
export function zipAssets(assets: Pick<AssetStore, 'read'>, entries: { path: string; name: string }[]): ReadableStream {
  const output = new PassThrough()
  const archive = new ZipArchive({ zlib: { level: 1 } })
  let current: Readable | undefined
  let next = 0
  const appendNext = () => {
    if (output.destroyed) return
    if (next === entries.length) return void archive.finalize().catch((error) => output.destroy(error))
    const { path, name } = entries[next++]
    assets.read(path).then(
      (asset) => {
        current = Readable.fromWeb(asset.stream as WebStream)
        if (output.destroyed) current.destroy()
        else archive.append(current, { name })
      },
      (error) => output.destroy(error),
    )
  }
  archive.on('error', (error) => output.destroy(error))
  archive.on('entry', appendNext)
  output.once('close', () => {
    archive.abort()
    current?.destroy()
  })
  archive.pipe(output)
  appendNext()
  return Readable.toWeb(output) as ReadableStream
}
