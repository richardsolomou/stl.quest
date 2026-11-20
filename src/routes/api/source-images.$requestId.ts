import { createFileRoute } from '@tanstack/react-router'
import { app } from '../../server/app'
import { withRequestContext } from '../../server/requestContext'
import { authorizedRequestAsset } from '../../server/requestAssetAccess'
import { imageContentType } from '../../core/coverImage'
import { loadSourceImage, sourceImageFailure } from '../../server/sourcePreview'
import { logger } from '../../server/logger'

const notFound = () => new Response('not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })

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
          if (!printRequest) return notFound()
          const cached = await context.service.cachedSourceImage(printRequest)
          if (cached) return imageResponse(cached, imageContentType(cached) ?? 'application/octet-stream')
          // A cover someone supplied has no source to fetch it from again.
          if (!printRequest.sourceImageUrl) return notFound()
          try {
            // First view of a cover fetches it from the source and stores it, so later views — other
            // people, other devices, cold browser caches — never hit the source site again.
            const image = await loadSourceImage(printRequest.sourceImageUrl)
            await context.service.cacheSourceImage(printRequest.id, image.bytes)
            return imageResponse(image.bytes, image.contentType)
          } catch (error) {
            const { status, details } = sourceImageFailure(error)
            logger.warn({ ...details, event: 'source_image_read_failed', request_id: params.requestId }, 'source image read failed')
            return new Response('preview unavailable', { status, headers: { 'Cache-Control': 'no-store' } })
          }
        }),
    },
  },
})
