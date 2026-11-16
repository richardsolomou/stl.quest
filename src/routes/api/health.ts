import { createFileRoute } from '@tanstack/react-router'
import { app } from '../../server/app'
import { healthResponse as checkedResponse } from '../../server/health'
import { withRequestContext } from '../../server/requestContext'

export async function healthResponse() {
  return checkedResponse(
    async () => {
      const instance = await app()
      await instance.repository.countUsers()
      await instance.staging.writable()
    },
    () => ({ code: 'service_unavailable', message: 'service unavailable' }),
  )
}

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: ({ request }) => withRequestContext(request, healthResponse),
    },
  },
})
