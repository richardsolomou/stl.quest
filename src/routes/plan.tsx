import { createFileRoute } from '@tanstack/react-router'
import { AccountRouteShell } from '../client/components/AccountRouteShell'
import { PlanPane } from '../client/components/settings/PlanPane'

export const Route = createFileRoute('/plan')({ component: PlanPage })

function PlanPage() {
  return <AccountRouteShell>{() => <PlanPane />}</AccountRouteShell>
}
