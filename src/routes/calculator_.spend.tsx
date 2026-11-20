import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { AppShell } from '../client/components/AppShell'
import { CalculatorTabs } from '../client/components/priceCalculator/CalculatorTabs'
import { PageHeader, SettingsPage } from '../client/components/settings/SettingsLayout'
import { SpendOverview, type SpendSearch } from '../client/components/spend/SpendOverview'
import { UsageTrackingInvite } from '../client/components/UsageTracking'
import { useI18n } from '../client/i18n'
import { sessionQuery } from '../client/queries'
import { useUsageTracking } from '../client/workspace'
import { localDay, SPEND_PERIODS, type SpendPeriodPreset } from '../core/spend'

function validateSpendSearch(input: Record<string, unknown>): SpendSearch {
  const day = (value: unknown) => (typeof value === 'string' && localDay(value) !== undefined ? value : undefined)
  return {
    period: SPEND_PERIODS.includes(input.period as SpendPeriodPreset) ? (input.period as SpendPeriodPreset) : undefined,
    from: day(input.from),
    to: day(input.to),
  }
}

export const Route = createFileRoute('/calculator_/spend')({ validateSearch: validateSpendSearch, component: SpendPage })

function SpendPage() {
  const { data: session } = useSuspenseQuery(sessionQuery())
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const identity = session.identity
  const authorized = Boolean(identity?.role === 'admin' && identity.workspaceSlug)
  useEffect(() => {
    if (!authorized) void navigate({ to: '/' })
  }, [authorized, navigate])
  if (!authorized) return null
  return (
    <AppShell active="calculator">
      <TrackedSpend
        workspaceSlug={identity!.workspaceSlug!}
        search={search}
        onSearchChange={(next) => void navigate({ search: next, replace: true })}
      />
    </AppShell>
  )
}

/** Spend is counted from the usage log, so while it is not kept the tab offers to start keeping it instead. */
function TrackedSpend(props: Parameters<typeof SpendOverview>[0]) {
  const { t } = useI18n()
  const tracking = useUsageTracking()
  if (tracking) return <SpendOverview {...props} />
  return (
    <SettingsPage>
      <PageHeader title={t.spend.title} description={t.spend.description} actions={<CalculatorTabs active="spend" />} />
      <UsageTrackingInvite source="spend" line={t.settings.board.tracking.invite.spend} explained />
    </SettingsPage>
  )
}
