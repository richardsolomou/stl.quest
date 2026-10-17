import { createFileRoute } from '@tanstack/react-router'
import { healthResponse as sharedHealthResponse } from 'ras-stack/server'
import { app } from '../../server/app'
import { withRequestContext } from '../../server/requestContext'

export async function healthResponse() {
  return sharedHealthResponse(
    async () => {
      const instance = await app()
      await instance.repository.countUsers()
      await instance.staging.writable()
    },
    { failure: () => ({ code: 'service_unavailable', message: 'service unavailable' }) },
  )
}

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: ({ request }) => withRequestContext(request, healthResponse),
    },
  },
})
