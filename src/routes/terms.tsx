import { createFileRoute, notFound } from '@tanstack/react-router'
import { landingHead, landingPage } from '../client/landing/discovery'
import { LegalPage } from '../client/landing/LegalPage'
import { sessionQuery } from '../client/queries'

export const Route = createFileRoute('/terms')({
  loader: async ({ context }) => {
    if (!(await context.queryClient.ensureQueryData(sessionQuery())).hosted) throw notFound()
    return { page: landingPage('/terms') }
  },
  head: ({ loaderData }) => (loaderData ? landingHead(loaderData.page) : {}),
  component: () => <LegalPage policy="terms" />,
})
