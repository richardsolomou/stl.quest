import { createFileRoute } from '@tanstack/react-router'
import { app } from '../../server/app'
import { withRequestContext } from '../../server/requestContext'
import { authorizedRequestAsset, requestPrintType } from '../../server/requestAssetAccess'
import { assetContentType } from '../../core/assetKeys'
import { taggedFileName } from '../../core/request'
import { assetResponse, attachmentDisposition } from '../../server/assetDownloads'

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
          })
          if (url.searchParams.get('inline') !== '1') {
            headers.set('Content-Disposition', attachmentDisposition(taggedFileName(printRequest.number, printRequest.fileName)))
            instance.telemetry.capture(context.identity.id, 'stl_download_served', {
              print_type: await requestPrintType(context.repository, printRequest),
            })
          }

          return assetResponse(request, asset, headers)
        }),
    },
  },
})
