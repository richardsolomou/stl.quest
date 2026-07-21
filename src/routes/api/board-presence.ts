import { createFileRoute } from '@tanstack/react-router'
import { app } from '../../server/app'
import { boardPresence } from '../../server/boardPresence'
import { ConnectionLimiter } from '../../server/connections'
import { withRequestContext } from '../../server/requestContext'

const connections = new ConnectionLimiter()

export const Route = createFileRoute('/api/board-presence')({
  server: {
    handlers: {
      GET: ({ request }) =>
        withRequestContext(request, async () => {
          const workspaceSlug = new URL(request.url).searchParams.get('workspace') ?? undefined
          const context = await (await app()).workspace(request.headers, workspaceSlug)
          const release = connections.enter(`${context.workspace.id}:${context.identity.id}`)
          if (!release) return Response.json({ error: 'too many presence connections' }, { status: 429 })
          const encoder = new TextEncoder()
          let leave = () => {}
          let heartbeat: ReturnType<typeof setInterval>
          let cleaned = false
          const cleanup = () => {
            if (cleaned) return
            cleaned = true
            leave()
            clearInterval(heartbeat)
            release()
          }
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('retry: 2000\n\n'))
              const send =
                context.identity.role === 'admin'
                  ? (viewers: unknown[]) => controller.enqueue(encoder.encode(`event: presence\ndata: ${JSON.stringify(viewers)}\n\n`))
                  : undefined
              leave = boardPresence.join(context.workspace.id, context.identity, send)
              heartbeat = setInterval(() => controller.enqueue(encoder.encode(': keepalive\n\n')), 20_000)
            },
            cancel: cleanup,
          })
          request.signal.addEventListener('abort', cleanup, { once: true })
          return new Response(stream, {
            headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
          })
        }),
    },
  },
})
