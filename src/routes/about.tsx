import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AppRail } from '../client/components/AppRail'
import { AboutPane } from '../client/components/settings/AboutPane'
import { sessionQuery } from '../client/queries'
import { useEscape } from '../client/useEscape'

export const Route = createFileRoute('/about')({ component: AboutPage })

function AboutPage() {
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
    <div className="flex h-dvh">
      <AppRail active="account" isAdmin={identity.role === 'admin'} isSuperAdmin={identity.superAdmin} navigationEnabled={hydrated} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-5 pt-7 pb-12">
          <AboutPane />
        </div>
      </main>
    </div>
  )
}
