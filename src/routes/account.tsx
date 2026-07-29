import { createFileRoute } from '@tanstack/react-router'
import { AccountRouteShell } from '../client/components/AccountRouteShell'
import { AccountPane } from '../client/components/settings/AccountPane'

export const Route = createFileRoute('/account')({ component: AccountSettingsPage })

function AccountSettingsPage() {
  return <AccountRouteShell>{(identity) => <AccountPane me={identity} />}</AccountRouteShell>
}
