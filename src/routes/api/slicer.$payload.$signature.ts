import { createFileRoute } from '@tanstack/react-router'
import { assetContentType } from '../../core/assetKeys'
import { taggedFileName } from '../../core/request'
import { app } from '../../server/app'
import { assetResponse, attachmentDisposition } from '../../server/assetDownloads'
import { authorizedRequestAsset, requestPrintType } from '../../server/requestAssetAccess'
import { withRequestContext } from '../../server/requestContext'

// A slicer fetches this without the browser session, so the signed link stands in for it: it names one request in
// one workspace for the member who asked, and that member must still be able to see the request when it is fetched.
export const Route = createFileRoute('/api/slicer/$payload/$signature')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        withRequestContext(
          request,
          async () => {
            const instance = await app()
            const context = await instance.slicerLinkWorkspace(params.payload, params.signature)
            const printRequest = context && (await authorizedRequestAsset(context, context.requestId))
            if (!context || !printRequest?.filePath || !printRequest.fileName) return new Response('not found', { status: 404 })
            let asset: { stream: ReadableStream; size: number }
            try {
              asset = await context.assets.read(printRequest.filePath)
            } catch {
              return new Response('file missing in storage', { status: 404 })
            }
            instance.telemetry.capture(context.identity.id, 'slicer_file_served', {
              print_type: await requestPrintType(context.repository, printRequest),
            })
            const headers = new Headers({
              'Content-Type': assetContentType(printRequest.filePath),
              'Content-Disposition': attachmentDisposition(taggedFileName(printRequest.number, printRequest.fileName)),
              'Cache-Control': 'private, no-store',
            })
            return assetResponse(request, asset, headers)
          },
          '/api/slicer/…',
        ),
    },
  },
})
