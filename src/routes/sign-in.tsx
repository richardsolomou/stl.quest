import { useSuspenseQuery } from '@tanstack/react-query'
import { Navigate, createFileRoute } from '@tanstack/react-router'
import { validateRequestSearch } from '../client/boardSearch'
import { AuthScreen } from '../client/components/AuthScreen'
import { sessionQuery } from '../client/queries'

export const Route = createFileRoute('/sign-in')({
  validateSearch: (input: Record<string, unknown>) => ({ signup: validateRequestSearch(input).signup }),
  component: SignIn,
})

function SignIn() {
  const { data: session } = useSuspenseQuery(sessionQuery())
  const { signup } = Route.useSearch()
  if (session.identity) return <Navigate to="/" />
  return <AuthScreen setupRequired={session.setupRequired} hosted={session.hosted} auth={session.auth} creatingAccount={signup} />
}
