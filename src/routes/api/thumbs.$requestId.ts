import { createFileRoute } from '@tanstack/react-router'
import { app } from '../../server/app'
import { thumbnailMime } from '../../core/assetKeys'

export const Route = createFileRoute('/api/thumbs/$requestId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const instance = await app()
        instance.auth.require()
        const printRequest = instance.service.getRequest(params.requestId)
        if (!printRequest?.thumbnailPath) return new Response('not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
        let asset: { stream: ReadableStream; size: number }
        try {
          asset = await instance.assets.read(printRequest.thumbnailPath)
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
      },
    },
  },
})
