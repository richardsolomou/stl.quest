import { useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'
import type { Identity } from '../../core/types'
import { sessionQuery } from '../queries'
import { useEscape } from '../useEscape'
import { AppRail, type AppView } from './AppRail'

export function AccountRouteShell({
  active = 'account',
  escapeTo,
  children,
}: {
  active?: AppView
  escapeTo?: string
  children: (identity: Identity) => ReactNode
}) {
  const { data: session } = useSuspenseQuery(sessionQuery())
  const [hydrated, setHydrated] = useState(false)
  const navigate = useNavigate()
  useEscape(escapeTo ? () => navigate({ to: escapeTo }) : () => undefined)
  const identity = session.identity

  useEffect(() => {
    setHydrated(true)
  }, [])
  useEffect(() => {
    if (!identity) void navigate({ to: '/' })
  }, [identity, navigate])

  if (!identity) return null
  return (
    <div className="flex h-dvh">
      <AppRail active={active} isAdmin={identity.role === 'admin'} isSuperAdmin={identity.superAdmin} navigationEnabled={hydrated} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-5 pt-7 pb-12">{children(identity)}</div>
      </main>
    </div>
  )
}
