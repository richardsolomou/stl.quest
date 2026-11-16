import { createFileRoute } from '@tanstack/react-router'
import { bundledPostHog } from '../../contracts/posthog'
import { forwardToPostHog } from '../../server/posthogProxy'

export const Route = createFileRoute('/t/$')({
  server: {
    handlers: {
      ANY: ({ request }) => (bundledPostHog ? forwardToPostHog(request, bundledPostHog) : new Response('Not found', { status: 404 })),
    },
  },
})
