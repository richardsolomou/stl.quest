import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AppRail } from '../client/components/AppRail'
import { PriceCalculator } from '../client/components/PriceCalculator'
import { sessionQuery } from '../client/queries'
import { useEscape } from '../client/useEscape'

export const Route = createFileRoute('/calculator')({ component: PriceCalculatorPage })

function PriceCalculatorPage() {
  const { data: session } = useSuspenseQuery(sessionQuery())
  const [hydrated, setHydrated] = useState(false)
  const navigate = useNavigate()
  useEscape(() => navigate({ to: '/' }))
  const identity = session.identity
  const authorized = Boolean(identity?.role === 'admin' && identity.workspaceSlug)
  useEffect(() => setHydrated(true), [])
  useEffect(() => {
    if (!authorized) void navigate({ to: '/' })
  }, [authorized, navigate])
  if (!authorized) return null
  return (
    <div className="fixed inset-0 flex overflow-hidden">
      <AppRail active="calculator" isAdmin isSuperAdmin={identity!.superAdmin} navigationEnabled={hydrated} />
      <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-none">
        <div className="mx-auto w-full max-w-5xl px-5 pt-7 pb-12">
          <PriceCalculator workspaceSlug={identity!.workspaceSlug!} />
        </div>
      </main>
    </div>
  )
}
