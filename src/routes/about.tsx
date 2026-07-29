import { createFileRoute } from '@tanstack/react-router'
import { AccountRouteShell } from '../client/components/AccountRouteShell'
import { AboutPane } from '../client/components/settings/AboutPane'

export const Route = createFileRoute('/about')({ component: AboutPage })

function AboutPage() {
  return <AccountRouteShell>{() => <AboutPane />}</AccountRouteShell>
}
