import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AppHeader } from '../client/components/AppHeader'
import { AccountPane } from '../client/components/settings/AccountPane'
import { sessionQuery } from '../client/queries'
import { useEscape } from '../client/useEscape'

export const Route = createFileRoute('/account')({ component: AccountSettingsPage })

function AccountSettingsPage() {
  const { data: session } = useSuspenseQuery(sessionQuery())
  const [hydrated, setHydrated] = useState(false)
  const navigate = useNavigate()
  useEscape(() => navigate({ to: '/' }))
  const identity = session.identity
  useEffect(() => {
    setHydrated(true)
  }, [])
  useEffect(() => {
    if (!identity) void navigate({ to: '/' })
  }, [identity, navigate])
  if (!identity) return null
  return (
    <div className="min-h-dvh">
      <AppHeader
        active="account"
        isAdmin={identity.role === 'admin'}
        isDeploymentAdmin={identity.deploymentAdmin}
        showPlanner={session.printers.length > 0}
        navigationEnabled={hydrated}
      />
      <main className="mx-auto w-full max-w-4xl px-5 pt-7 pb-12">
        <AccountPane me={identity} />
      </main>
    </div>
  )
}
