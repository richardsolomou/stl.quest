import { createFileRoute } from '@tanstack/react-router'
import { cloudStorageAuthorizationCallback } from '../server/cloudConnections'

export const Route = createFileRoute('/api/storage/dropbox/callback')({
  server: {
    handlers: {
      GET: ({ request }) => cloudStorageAuthorizationCallback(request, 'dropbox'),
    },
  },
})
