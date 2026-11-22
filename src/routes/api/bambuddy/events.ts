import { createFileRoute } from '@tanstack/react-router'
import { receiveBambuddyRequest } from '../../../server/bambuddyIngest'
import { withRequestContext } from '../../../server/requestContext'

export const Route = createFileRoute('/api/bambuddy/events')({
  server: {
    handlers: {
      POST: ({ request }) => withRequestContext(request, () => receiveBambuddyRequest(request)),
    },
  },
})
