import { createFileRoute } from '@tanstack/react-router'
import { app } from '../../server/app'
import { withAuthInvite, withAuthProvisioning } from '../../server/authInvite'
import { withRequestContext } from '../../server/requestContext'

const INVITE_COOKIE = 'printhub_invite'

function cookie(request: Request, name: string) {
  const value = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
  return value ? decodeURIComponent(value.slice(name.length + 1)) : undefined
}

const handle = (request: Request) =>
  withRequestContext(request, async () =>
    withAuthInvite(cookie(request, INVITE_COOKIE), async () => {
      const instance = await app()
      const run = () => instance.auth.handler(request)
      const provisioning = new URL(request.url).pathname.endsWith('/admin/create-user')
      const response = await (provisioning ? withAuthProvisioning(run) : run())
      if (!new URL(request.url).pathname.includes('/callback/')) return response
      const headers = new Headers(response.headers)
      headers.append('set-cookie', `${INVITE_COOKIE}=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0`)
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    }),
  )

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
})
