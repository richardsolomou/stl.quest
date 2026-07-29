import { createFileRoute } from '@tanstack/react-router'
import { app, resolveBoardConfig } from '../../server/app'
import { ConnectionLimiter } from '../../server/connections'
import { presenceConnection } from '../../server/presenceConnection'
import { withRequestContext } from '../../server/requestContext'
import { serverSentComment, serverSentEvent, serverSentEventResponse, serverSentRetry } from '../../server/serverSentEvents'

const connections = new ConnectionLimiter()

export const Route = createFileRoute('/api/board-presence')({
  server: {
    handlers: {
      GET: ({ request }) =>
        withRequestContext(request, async () => {
          const workspaceSlug = new URL(request.url).searchParams.get('workspace') ?? undefined
          const instance = await app()
          const context = await instance.workspace(request.headers, workspaceSlug)
          const release = connections.enter(`${context.workspace.id}:${context.identity.id}`)
          if (!release) return Response.json({ error: 'too many presence connections' }, { status: 429 })
          const connection = presenceConnection(release)
          const stream = new ReadableStream({
            async start(controller) {
              controller.enqueue(serverSentRetry(2_000))
              const send =
                context.identity.role === 'admin' || !(await resolveBoardConfig(context.repository)).privateRequests
                  ? (viewers: unknown[]) => controller.enqueue(serverSentEvent('presence', JSON.stringify(viewers)))
                  : undefined
              const joinedLeave = await instance.boardPresence.join(context.workspace.id, context.identity, send)
              connection.activate(joinedLeave, () => setInterval(() => controller.enqueue(serverSentComment('keepalive')), 20_000))
            },
            cancel: () => connection.cleanup(),
          })
          request.signal.addEventListener('abort', () => connection.cleanup(), { once: true })
          return serverSentEventResponse(stream)
        }),
    },
  },
})
