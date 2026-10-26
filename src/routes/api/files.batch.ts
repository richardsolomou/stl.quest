import { createFileRoute } from '@tanstack/react-router'
import { MAX_ARCHIVE_FILES, MAX_ARCHIVE_MODELS, uniqueArchiveNames } from '../../core/archive'
import { app } from '../../server/app'
import { zipAssets } from '../../server/assetDownloads'
import { authorizedRequestAsset } from '../../server/requestAssetAccess'
import { withRequestContext } from '../../server/requestContext'

// Checks run a few at a time so the download starts promptly without flooding the storage provider.
const CHECK_CONCURRENCY = 8

export const Route = createFileRoute('/api/files/batch')({
  server: {
    handlers: {
      GET: ({ request }) =>
        withRequestContext(request, async () => {
          // A repeated id adds one file per copy.
          const files = new URL(request.url).searchParams.getAll('id')
          const ids = [...new Set(files)]
          if (files.length < 2 || ids.length > MAX_ARCHIVE_MODELS || files.length > MAX_ARCHIVE_FILES)
            return new Response(`choose 2 to ${MAX_ARCHIVE_FILES} files from up to ${MAX_ARCHIVE_MODELS} models`, { status: 400 })

          const instance = await app()
          const context = await instance.workspace(request.headers)
          const check = async (id: string) => {
            const printRequest = await authorizedRequestAsset(context, id)
            if (!printRequest?.filePath || !printRequest.fileName) return new Response('not found', { status: 404 })
            if (!(await context.assets.stat(printRequest.filePath).catch(() => undefined)))
              return new Response('file missing in storage', { status: 404 })
            return { path: printRequest.filePath, fileName: printRequest.fileName }
          }
          const models = new Map<string, { path: string; fileName: string }>()
          for (let start = 0; start < ids.length; start += CHECK_CONCURRENCY) {
            const batch = ids.slice(start, start + CHECK_CONCURRENCY)
            for (const [index, model] of (await Promise.all(batch.map(check))).entries()) {
              if (model instanceof Response) return model
              models.set(batch[index], model)
            }
          }

          const entries = files.map((id) => models.get(id)!)
          const names = uniqueArchiveNames(entries.map(({ fileName }) => fileName))
          const archive = zipAssets(
            context.assets,
            entries.map(({ path }, index) => ({ path, name: names[index] })),
          )
          void instance.telemetry
            .capture(context.identity.id, 'stl_batch_download_served', { request_count: ids.length, file_count: files.length })
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
