import { ZipArchive } from 'archiver'
import { PassThrough, Readable } from 'node:stream'
import { createFileRoute } from '@tanstack/react-router'
import { uniqueArchiveNames } from '../../core/archive'
import { app } from '../../server/app'
import { authorizedRequestAsset } from '../../server/requestAssetAccess'
import { withRequestContext } from '../../server/requestContext'

const MAX_BATCH_DOWNLOADS = 100

export const Route = createFileRoute('/api/files/batch')({
  server: {
    handlers: {
      GET: ({ request }) =>
        withRequestContext(request, async () => {
          const ids = [...new Set(new URL(request.url).searchParams.getAll('id'))]
          if (ids.length < 2 || ids.length > MAX_BATCH_DOWNLOADS) return new Response('choose between 2 and 100 models', { status: 400 })

          const instance = await app()
          const context = await instance.workspace(request.headers)
          const models = []
          for (const id of ids) {
            const printRequest = await authorizedRequestAsset(context, id)
            if (!printRequest?.filePath || !printRequest.fileName) return new Response('not found', { status: 404 })
            try {
              const asset = await context.assets.read(printRequest.filePath)
              models.push({ asset, fileName: printRequest.fileName })
            } catch {
              return new Response('file missing in storage', { status: 404 })
            }
          }

          const output = new PassThrough()
          const archive = new ZipArchive({ zlib: { level: 1 } })
          archive.on('error', (error) => output.destroy(error))
          archive.pipe(output)
          const names = uniqueArchiveNames(models.map(({ fileName }) => fileName))
          models.forEach(({ asset }, index) => {
            archive.append(Readable.fromWeb(asset.stream as Parameters<typeof Readable.fromWeb>[0]), { name: names[index] })
          })
          void archive.finalize().catch((error) => output.destroy(error))
          void instance.telemetry
            .capture(context.identity.id, 'stl_batch_download_served', { request_count: ids.length })
            .catch(() => undefined)

          return new Response(Readable.toWeb(output) as ReadableStream, {
            headers: {
              'Content-Type': 'application/zip',
              'Content-Disposition': 'attachment; filename="stlquest-models.zip"',
              'Cache-Control': 'private, no-store',
            },
          })
        }),
    },
  },
})
