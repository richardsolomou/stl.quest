import { createFileRoute } from '@tanstack/react-router'
import { app } from '../../../server/app'
import { withRequestContext } from '../../../server/requestContext'

export const Route = createFileRoute('/api/realtime/token')({
  server: {
    handlers: { POST: ({ request }) => withRequestContext(request, async () => (await app()).realtime.ticket(request)) },
  },
})
