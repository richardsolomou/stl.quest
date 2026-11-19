import { createFileRoute } from '@tanstack/react-router'
import { PlanPane } from '../client/components/settings/PlanPane'
import { SettingsShell } from '../client/components/settings/SettingsShell'

export const Route = createFileRoute('/plan')({ component: PlanPage })

function PlanPage() {
  return (
    <SettingsShell current={{ kind: 'plan' }}>
      <PlanPane />
    </SettingsShell>
  )
}
