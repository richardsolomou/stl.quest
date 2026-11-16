import { createFileRoute } from '@tanstack/react-router'
import { app } from '../../server/app'
import { checkDependency, healthResponse as checkedResponse } from '../../server/health'
import { withRequestContext } from '../../server/requestContext'

export async function healthResponse() {
  return checkedResponse(async () => {
    const instance = await app()
    await checkDependency('service_unavailable', 'service unavailable', async () => {
      await instance.repository.countUsers()
      await instance.staging.writable()
    })
  })
}

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: ({ request }) => withRequestContext(request, healthResponse),
    },
  },
})
