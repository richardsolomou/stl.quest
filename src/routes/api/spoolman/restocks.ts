import { createFileRoute } from '@tanstack/react-router'
import { withRequestContext } from '../../../server/requestContext'
import { receiveSpoolmanRestockResult, sendSpoolmanRestocks } from '../../../server/spoolmanRestocksIngest'

export const Route = createFileRoute('/api/spoolman/restocks')({
  server: {
    handlers: {
      GET: ({ request }) => withRequestContext(request, () => sendSpoolmanRestocks(request)),
      POST: ({ request }) => withRequestContext(request, () => receiveSpoolmanRestockResult(request)),
    },
  },
})
