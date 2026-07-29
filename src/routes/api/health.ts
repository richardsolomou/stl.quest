import { createFileRoute } from '@tanstack/react-router'
import { errorMessage } from '../../core/error'
import { app } from '../../server/app'
import { withRequestContext } from '../../server/requestContext'

export async function healthResponse() {
  try {
    const instance = await app()
    await instance.repository.countUsers()
    await instance.staging.writable()
    return Response.json({ ok: true })
  } catch (error) {
    return Response.json({ ok: false, error: errorMessage(error, 'health check failed') }, { status: 503 })
  }
}

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: ({ request }) => withRequestContext(request, healthResponse),
    },
  },
})
