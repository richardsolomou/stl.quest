import { useSuspenseQuery } from '@tanstack/react-query'
import { Navigate, createFileRoute } from '@tanstack/react-router'
import { PlanPane } from '../client/components/settings/PlanPane'
import { SettingsShell } from '../client/components/settings/SettingsShell'
import { sessionQuery } from '../client/queries'

export const Route = createFileRoute('/plan')({ component: PlanPage })

// Navigation offers Plan only where billing runs, so a direct visit elsewhere lands on the account page instead.
function PlanPage() {
  const { data: session } = useSuspenseQuery(sessionQuery())
  if (!session.billing?.available) return <Navigate to={session.identity ? '/account' : '/'} replace />
  return (
    <SettingsShell current={{ kind: 'plan' }}>
      <PlanPane />
    </SettingsShell>
  )
}
