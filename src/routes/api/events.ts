import { createFileRoute } from '@tanstack/react-router'
import { app } from '../../server/app'
import { ConnectionLimiter } from '../../server/connections'

const connections = new ConnectionLimiter()

export const Route = createFileRoute('/api/events')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const instance = await app()
        const identity = await instance.requireIdentity(request.headers)
        const release = connections.enter(identity.id)
        if (!release) return Response.json({ error: 'too many event connections' }, { status: 429 })
        const encoder = new TextEncoder()
        let unsubscribe = () => {}
        let heartbeat: ReturnType<typeof setInterval>
        let cleaned = false
        const cleanup = () => {
          if (cleaned) return
          cleaned = true
          unsubscribe()
          clearInterval(heartbeat)
          release()
        }
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('retry: 2000\n\n'))
            unsubscribe = instance.events.subscribe((event) => controller.enqueue(encoder.encode(`event: change\ndata: ${event}\n\n`)))
            heartbeat = setInterval(() => controller.enqueue(encoder.encode(': keepalive\n\n')), 20_000)
          },
          cancel: cleanup,
        })
        request.signal.addEventListener('abort', cleanup, { once: true })
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' } })
      },
    },
  },
})
