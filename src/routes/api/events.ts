import { createFileRoute } from '@tanstack/react-router'
import { app } from '../../server/app'
import { ConnectionLimiter } from '../../server/connections'
import { withRequestContext } from '../../server/requestContext'
import { serverSentComment, serverSentEvent, serverSentEventResponse, serverSentRetry } from '../../server/serverSentEvents'

const connections = new ConnectionLimiter()

export const Route = createFileRoute('/api/events')({
  server: {
    handlers: {
      GET: ({ request }) =>
        withRequestContext(request, async () => {
          const instance = await app()
          const context = await instance.workspace(request.headers)
          const release = connections.enter(`${context.workspace.id}:${context.identity.id}`)
          if (!release) return Response.json({ error: 'too many event connections' }, { status: 429 })
          let unsubscribe = () => {}
          let unsubscribeClose = () => {}
          let heartbeat: ReturnType<typeof setInterval>
          let cleaned = false
          const cleanup = () => {
            if (cleaned) return
            cleaned = true
            unsubscribe()
            unsubscribeClose()
            clearInterval(heartbeat)
            release()
          }
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(serverSentRetry(2_000))
              unsubscribe = context.events.subscribe((event) => controller.enqueue(serverSentEvent('change', event)))
              // When resetApp replaces the bus, end the stream so the browser
              // reconnects to the new one instead of listening to a dead bus.
              unsubscribeClose = context.events.onClose(() => {
                cleanup()
                try {
                  controller.close()
                } catch {}
              })
              heartbeat = setInterval(() => controller.enqueue(serverSentComment('keepalive')), 20_000)
            },
            cancel: cleanup,
          })
          request.signal.addEventListener('abort', cleanup, { once: true })
          return serverSentEventResponse(stream)
        }),
    },
  },
})
