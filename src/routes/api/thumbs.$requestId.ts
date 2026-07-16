import { createFileRoute } from '@tanstack/react-router'
import { app, resolveBoardConfig } from '../../server/app'
import { thumbnailMime } from '../../core/assetKeys'
import { withRequestContext } from '../../server/requestContext'

export const Route = createFileRoute('/api/thumbs/$requestId')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        withRequestContext(request, async () => {
          const instance = await app()
          const context = await instance.workspace(request.headers)
          const printRequest = context.service.getRequest(params.requestId)
          if (!printRequest?.thumbnailPath) return new Response('not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
          if (
            context.identity.role !== 'admin' &&
            resolveBoardConfig(context.repository).privateRequests &&
            printRequest.ownerUserId !== context.identity.id
          )
            return new Response('not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
          let asset: { stream: ReadableStream; size: number }
          try {
            asset = await context.assets.read(printRequest.thumbnailPath)
          } catch {
            return new Response('not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
          }
          return new Response(asset.stream, {
            headers: {
              'Content-Type': thumbnailMime(printRequest.thumbnailPath),
              'Content-Length': String(asset.size),
              'Cache-Control': 'private, max-age=31536000, immutable',
            },
          })
        }),
    },
  },
})
