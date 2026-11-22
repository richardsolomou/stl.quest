import { createFileRoute } from '@tanstack/react-router'
import { withRequestContext } from '../../../server/requestContext'
import { receiveSpoolmanRequest } from '../../../server/spoolmanIngest'

export const Route = createFileRoute('/api/spoolman/spools')({
  server: {
    handlers: {
      POST: ({ request }) => withRequestContext(request, () => receiveSpoolmanRequest(request)),
    },
  },
})
