import { createFileRoute } from '@tanstack/react-router'
import { app, memberSeesOnlyOwnRequests } from '../../../server/app'
import { canSubscribeToBoard, connectionToken, realtimeConfig, subscriptionToken } from '../../../server/realtime'
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
          const ownRequestsOnly = await memberSeesOnlyOwnRequests(context.repository, context.identity)
          if (!canSubscribeToBoard(body.channel, context.workspace.slug, ownRequestsOnly)) {
            return Response.json({ error: 'channel not found' }, { status: 404 })
          }
          return Response.json({ token: subscriptionToken(context.identity, body.channel, realtimeConfig().secret) })
        }),
    },
  },
})
