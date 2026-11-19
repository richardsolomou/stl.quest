import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { AccountPane } from '../client/components/settings/AccountPane'
import { SettingsShell } from '../client/components/settings/SettingsShell'
import { sessionQuery } from '../client/queries'

export const Route = createFileRoute('/account')({ component: AccountSettingsPage })

function AccountSettingsPage() {
  const { data: session } = useSuspenseQuery(sessionQuery())
  return <SettingsShell current={{ kind: 'account' }}>{session.identity && <AccountPane me={session.identity} />}</SettingsShell>
}
