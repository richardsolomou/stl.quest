import { createFileRoute } from '@tanstack/react-router'
import { app, resolveBoardConfig } from '../../../server/app'
import { connectionToken, realtimeConfig, subscriptionToken } from '../../../server/realtime'
import { withRequestContext } from '../../../server/requestContext'

export const Route = createFileRoute('/api/realtime/token')({
  server: {
    handlers: {
      GET: ({ request }) =>
        withRequestContext(request, async () => {
          const context = await (await app()).workspace(request.headers)
          return Response.json({ token: connectionToken(context.identity, realtimeConfig().secret) })
        }),
      POST: ({ request }) =>
        withRequestContext(request, async () => {
          const context = await (await app()).workspace(request.headers)
          const body = (await request.json()) as { channel?: unknown }
          if (
            body.channel === `board:${context.workspace.slug}` &&
            context.identity.role !== 'admin' &&
            (await resolveBoardConfig(context.repository)).privateRequests
          ) {
            return Response.json({ error: 'channel not found' }, { status: 404 })
          }
          if (body.channel !== `board:${context.workspace.slug}`) {
            return Response.json({ error: 'channel not found' }, { status: 404 })
          }
          return Response.json({ token: subscriptionToken(context.identity, body.channel, realtimeConfig().secret) })
        }),
    },
  },
})
