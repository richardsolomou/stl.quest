import { createFileRoute } from '@tanstack/react-router'
import { app } from '../../server/app'
import { parseCookies } from 'better-auth/cookies'
import { INVITE_COOKIE, prepareAuthRequest, secureResponseCookies } from '../../server/authCookies'
import { withAuthInvite, withAuthProvisioning } from '../../server/authInvite'
import { withRequestContext } from '../../server/requestContext'

const handle = (request: Request) =>
  withRequestContext(request, async () =>
    withAuthInvite(parseCookies(request.headers.get('cookie') ?? '').get(INVITE_COOKIE), async () => {
      const instance = await app()
      const run = () => instance.auth.handler(prepareAuthRequest(request))
      const provisioning = new URL(request.url).pathname.endsWith('/admin/create-user')
      const response = await (provisioning ? withAuthProvisioning(run) : run())
      if (!new URL(request.url).pathname.includes('/callback/')) return secureResponseCookies(request, response)
      const headers = new Headers(response.headers)
      headers.append('set-cookie', `${INVITE_COOKIE}=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0`)
      return secureResponseCookies(
        request,
        new Response(response.body, { status: response.status, statusText: response.statusText, headers }),
      )
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
