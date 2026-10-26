import { createFileRoute, redirect } from '@tanstack/react-router'
import { landingHead, landingPage } from '../client/landing/discovery'
import { HomePage } from '../client/landing/HomePage'
import { sessionQuery } from '../client/queries'

export const Route = createFileRoute('/home')({
  beforeLoad: async ({ context }) => {
    if (!(await context.queryClient.ensureQueryData(sessionQuery())).hosted) throw redirect({ to: '/' })
  },
  head: () => landingHead(landingPage('/')),
  component: HomePage,
})
