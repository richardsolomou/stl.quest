import { createFileRoute } from '@tanstack/react-router'
import { app, resolveBoardConfig } from '../../server/app'
import { thumbnailMime } from '../../core/assetKeys'
import { withRequestContext } from '../../server/requestContext'
import { logger } from '../../server/logger'
import { readThumbnail } from '../../server/thumbnail'

export const Route = createFileRoute('/api/thumbs/$requestId')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        withRequestContext(request, async () => {
          const instance = await app()
          const context = await instance.workspace(request.headers)
          const printRequest = await context.service.getRequest(params.requestId)
          if (!printRequest?.thumbnailPath) return new Response('not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
          if (
            context.identity.role !== 'admin' &&
            (await resolveBoardConfig(context.repository)).privateRequests &&
            printRequest.ownerUserId !== context.identity.id
          )
            return new Response('not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
          const thumbnail = await readThumbnail(context.assets, printRequest.thumbnailPath)
          if (thumbnail.status === 'missing') return new Response('not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
          if (thumbnail.status === 'unavailable') {
            logger.warn(
              { err: thumbnail.error, event: 'thumbnail_read_failed', request_id: params.requestId },
              'thumbnail storage read failed',
            )
            return new Response('temporarily unavailable', {
              status: 503,
              headers: { 'Cache-Control': 'no-store', 'Retry-After': '1' },
            })
          }
          return new Response(thumbnail.bytes, {
            headers: {
              'Content-Type': thumbnailMime(printRequest.thumbnailPath),
              'Content-Length': String(thumbnail.bytes.byteLength),
              'Cache-Control': 'private, max-age=31536000, immutable',
            },
          })
        }),
    },
  },
})
