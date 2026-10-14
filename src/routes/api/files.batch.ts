import { createFileRoute } from '@tanstack/react-router'
import { uniqueArchiveNames } from '../../core/archive'
import { app } from '../../server/app'
import { zipAssets } from '../../server/assetDownloads'
import { authorizedRequestAsset } from '../../server/requestAssetAccess'
import { withRequestContext } from '../../server/requestContext'

const MAX_BATCH_DOWNLOADS = 100
// Checks run a few at a time so the download starts promptly without flooding the storage provider.
const CHECK_CONCURRENCY = 8

export const Route = createFileRoute('/api/files/batch')({
  server: {
    handlers: {
      GET: ({ request }) =>
        withRequestContext(request, async () => {
          const ids = [...new Set(new URL(request.url).searchParams.getAll('id'))]
          if (ids.length < 2 || ids.length > MAX_BATCH_DOWNLOADS) return new Response('choose between 2 and 100 models', { status: 400 })

          const instance = await app()
          const context = await instance.workspace(request.headers)
          const check = async (id: string) => {
            const printRequest = await authorizedRequestAsset(context, id)
            if (!printRequest?.filePath || !printRequest.fileName) return new Response('not found', { status: 404 })
            if (!(await context.assets.stat(printRequest.filePath).catch(() => undefined)))
              return new Response('file missing in storage', { status: 404 })
            return { path: printRequest.filePath, fileName: printRequest.fileName }
          }
          const models = []
          for (let start = 0; start < ids.length; start += CHECK_CONCURRENCY) {
            for (const model of await Promise.all(ids.slice(start, start + CHECK_CONCURRENCY).map(check))) {
              if (model instanceof Response) return model
              models.push(model)
            }
          }

          const names = uniqueArchiveNames(models.map(({ fileName }) => fileName))
          const archive = zipAssets(
            context.assets,
            models.map(({ path }, index) => ({ path, name: names[index] })),
          )
          void instance.telemetry
            .capture(context.identity.id, 'stl_batch_download_served', { request_count: ids.length })
            .catch(() => undefined)

          return new Response(archive, {
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
