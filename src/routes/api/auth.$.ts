import { createFileRoute } from '@tanstack/react-router'
import { app } from '../../server/app'

const handle = async (request: Request) => (await app()).auth.handler(request)

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
})
