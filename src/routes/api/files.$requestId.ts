import { createFileRoute } from '@tanstack/react-router'
import { app } from '../../server/app'
import { withRequestContext } from '../../server/requestContext'
import { authorizedRequestAsset } from '../../server/requestAssetAccess'
import { storedPrinterProfiles } from '../../core/printers'
import { assetContentType } from '../../core/assetKeys'
import { attachmentDisposition, gzipAssetStream } from '../../server/assetDownloads'

export const Route = createFileRoute('/api/files/$requestId')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        withRequestContext(request, async () => {
          const instance = await app()
          const context = await instance.workspace(request.headers)
          const printRequest = await authorizedRequestAsset(context, params.requestId)
          if (!printRequest?.filePath || !printRequest.fileName) return new Response('not found', { status: 404 })

          const url = new URL(request.url)
          const wantPreview = url.searchParams.get('preview') === '1'
          const relativePath = wantPreview && printRequest.previewPath ? printRequest.previewPath : printRequest.filePath
          let asset: { stream: ReadableStream; size: number }
          try {
            asset = await context.assets.read(relativePath)
          } catch {
            return new Response('file missing in storage', { status: 404 })
          }

          const currentPreview = wantPreview && relativePath.toLowerCase().endsWith('.phm')
          const headers = new Headers({
            'Content-Type': currentPreview ? 'application/octet-stream' : assetContentType(relativePath),
            'Cache-Control': wantPreview ? 'private, no-cache' : 'private, max-age=31536000, immutable',
            // Uncompressed size, so the client can show progress across gzip.
            'X-File-Size': String(asset.size),
          })
          if (url.searchParams.get('inline') !== '1') {
            headers.set('Content-Disposition', attachmentDisposition(printRequest.fileName))
            const assignedPrinter = printRequest.printerId
              ? (await storedPrinterProfiles(context.repository)).find(({ id }) => id === printRequest.printerId)
              : undefined
            void instance.telemetry
              .capture(context.identity.id, 'stl_download_served', {
                print_type: assignedPrinter?.printType ?? printRequest.requestedPrintType,
              })
              .catch(() => undefined)
          }

          if ((request.headers.get('accept-encoding') ?? '').includes('gzip')) {
            headers.set('Content-Encoding', 'gzip')
            return new Response(gzipAssetStream(asset.stream), { headers })
          }
          headers.set('Content-Length', String(asset.size))
          return new Response(asset.stream, { headers })
        }),
    },
  },
})
