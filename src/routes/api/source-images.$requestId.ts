import { createFileRoute } from '@tanstack/react-router'
import { app } from '../../server/app'
import { withRequestContext } from '../../server/requestContext'
import { authorizedRequestAsset } from '../../server/requestAssetAccess'
import { loadSourceImage, sourceImageContentType } from '../../server/sourcePreview'
import { logger } from '../../server/logger'

const imageResponse = (bytes: Uint8Array<ArrayBuffer>, contentType: string) =>
  new Response(bytes, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, max-age=3600',
    },
  })

export const Route = createFileRoute('/api/source-images/$requestId')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        withRequestContext(request, async () => {
          const instance = await app()
          const context = await instance.workspace(request.headers)
          const printRequest = await authorizedRequestAsset(context, params.requestId)
          if (!printRequest?.sourceImageUrl) {
            return new Response('not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
          }
          const cached = await context.service.cachedSourceImage(printRequest)
          if (cached) return imageResponse(cached, sourceImageContentType(cached) ?? 'application/octet-stream')
          try {
            // First view of a cover fetches it from the source and stores it, so later views — other
            // people, other devices, cold browser caches — never hit the source site again.
            const image = await loadSourceImage(printRequest.sourceImageUrl)
            await context.service.cacheSourceImage(printRequest.id, image.bytes)
            return imageResponse(image.bytes, image.contentType)
          } catch (error) {
            logger.warn({ err: error, event: 'source_image_read_failed', request_id: params.requestId }, 'source image read failed')
            const status = error instanceof Response ? error.status : 502
            return new Response('preview unavailable', { status, headers: { 'Cache-Control': 'no-store' } })
          }
        }),
    },
  },
})
