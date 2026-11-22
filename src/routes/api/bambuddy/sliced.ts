import { createFileRoute } from '@tanstack/react-router'
import { receiveSlicedFileRequest, sendSlicedFilesWanted, slicedFileUnavailableRequest } from '../../../server/bambuddyIngest'
import { withRequestContext } from '../../../server/requestContext'

export const Route = createFileRoute('/api/bambuddy/sliced')({
  server: {
    handlers: {
      GET: ({ request }) => withRequestContext(request, () => sendSlicedFilesWanted(request)),
      POST: ({ request }) => withRequestContext(request, () => receiveSlicedFileRequest(request)),
      DELETE: ({ request }) => withRequestContext(request, () => slicedFileUnavailableRequest(request)),
    },
  },
})
