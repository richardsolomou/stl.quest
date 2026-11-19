import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { AppShell } from '../client/components/AppShell'
import { calculatorPrefill, validateCalculatorSearch } from '../client/calculatorSearch'
import { PriceCalculator } from '../client/components/PriceCalculator'
import { sessionQuery } from '../client/queries'

export const Route = createFileRoute('/calculator')({ validateSearch: validateCalculatorSearch, component: PriceCalculatorPage })

function PriceCalculatorPage() {
  const { data: session } = useSuspenseQuery(sessionQuery())
  const search = Route.useSearch()
  const navigate = useNavigate()
  const identity = session.identity
  const authorized = Boolean(identity?.role === 'admin' && identity.workspaceSlug)
  useEffect(() => {
    if (!authorized) void navigate({ to: '/' })
  }, [authorized, navigate])
  if (!authorized) return null
  return (
    <AppShell active="calculator">
      <PriceCalculator workspaceSlug={identity!.workspaceSlug!} prefill={calculatorPrefill(search)} />
    </AppShell>
  )
}
