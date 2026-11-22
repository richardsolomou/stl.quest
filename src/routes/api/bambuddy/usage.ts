import { createFileRoute } from '@tanstack/react-router'
import { receivePrintUsageRequest } from '../../../server/bambuddyIngest'
import { withRequestContext } from '../../../server/requestContext'

export const Route = createFileRoute('/api/bambuddy/usage')({
  server: {
    handlers: {
      POST: ({ request }) => withRequestContext(request, () => receivePrintUsageRequest(request)),
    },
  },
})
