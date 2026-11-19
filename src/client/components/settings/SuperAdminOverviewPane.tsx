import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CircleCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { formatBytes } from '../../../core/format'
import { storagePlans, type StoragePlan } from '../../../core/plans'
import type { Account } from '../../../core/types'
import { adminWorkspaceAttentionReasons, type AdminWorkspace } from '../../../core/admin'
import { useI18n } from '../../i18n'
import { accountsQuery, adminWorkspacesQuery } from '../../queries'
import { QueryState } from '../QueryState'
import { PageHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { SuperAdminWorkspaceDialog } from './SuperAdminWorkspaceDialog'

const DAY = 24 * 60 * 60 * 1_000

export function SuperAdminOverviewPane({ hosted }: { hosted: boolean }) {
  const { t } = useI18n()
  const copy = t.superAdmin.overview
  const accountsResult = useQuery(accountsQuery())
  const workspacesResult = useQuery(adminWorkspacesQuery())
  const [selected, setSelected] = useState<AdminWorkspace>()
  const accounts = accountsResult.data
  const workspaces = workspacesResult.data

  if (!accounts || !workspaces) {
    return (
      <SettingsPage>
        <PageHeader title={copy.title} description={copy.description} />
        <QueryState
          loading={accountsResult.isPending || workspacesResult.isPending}
          error={accountsResult.error ?? workspacesResult.error}
          loadingLabel={copy.loading}
          errorTitle={copy.loadError}
          onRetry={() => void Promise.all([accountsResult.refetch(), workspacesResult.refetch()])}
        />
      </SettingsPage>
    )
  }

  const now = Date.now()
  const thirtyDaysAgo = now - 30 * DAY
  const activeAccounts = accounts.filter((account) => account.lastOnlineAt && account.lastOnlineAt >= thirtyDaysAgo).length
  const newAccounts = accounts.filter((account) => account.createdAt >= thirtyDaysAgo).length
  const newWorkspaces = workspaces.filter((workspace) => workspace.createdAt >= thirtyDaysAgo).length
  const requests = workspaces.reduce((total, workspace) => total + workspace.requestCount, 0)
  const copies = workspaces.reduce((total, workspace) => total + workspace.copyCount, 0)
  const attention = workspaces
    .map((workspace) => ({ workspace, reasons: adminWorkspaceAttentionReasons(workspace, t.superAdmin) }))
    .filter(({ reasons }) => reasons.length)
    .sort((left, right) => right.reasons.length - left.reasons.length || left.workspace.name.localeCompare(right.workspace.name))

  return (
    <SettingsPage>
      <PageHeader title={copy.title} description={copy.description} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryCard label={copy.users} value={accounts.length} detail={copy.newInLast30Days(newAccounts)} />
        <SummaryCard label={copy.activeUsers} value={activeAccounts} detail={copy.activeUsersDetail} />
        <SummaryCard label={copy.workspaces} value={workspaces.length} detail={copy.newInLast30Days(newWorkspaces)} />
        <SummaryCard label={copy.printRequests} value={requests} detail={copy.printRequestsDetail} />
        <SummaryCard label={copy.printCopies} value={copies} detail={copy.printCopiesDetail} />
        <SummaryCard
          label={copy.needsAttention}
          value={attention.length}
          detail={attention.length ? copy.needsAttentionDetail : copy.noProblems}
        />
      </div>

      {hosted && <HostedStorageValue accounts={accounts} />}

      <SettingsSection title={copy.needsAttention} description={copy.attentionDescription}>
        {attention.length ? (
          <div className="divide-y overflow-hidden rounded-sm border">
            {attention.slice(0, 8).map(({ workspace, reasons }) => (
              <Button
                key={workspace.id}
                type="button"
                variant="ghost"
                className="h-auto w-full justify-between rounded-none px-5 py-3 text-left"
                onClick={() => setSelected(workspace)}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{workspace.name}</span>
                  <span className="block truncate text-xs font-normal text-muted-foreground">{reasons.join(' · ')}</span>
                </span>
                <Badge variant="destructive">{copy.review}</Badge>
              </Button>
            ))}
          </div>
        ) : (
          <Empty className="border-0 p-4">
            <EmptyMedia variant="icon">
              <CircleCheck />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>{copy.healthyTitle}</EmptyTitle>
              <EmptyDescription>{copy.healthyDescription}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </SettingsSection>
      {selected && <SuperAdminWorkspaceDialog workspace={selected} onDone={() => setSelected(undefined)} />}
    </SettingsPage>
  )
}

function HostedStorageValue({ accounts }: { accounts: Account[] }) {
  const { t, locale } = useI18n()
  const copy = t.superAdmin.hostedStorage
  const planNames = t.settings.plan.names
  const plans = Object.keys(storagePlans) as StoragePlan[]
  const customerAccounts = accounts.filter((account) => account.role !== 'super_admin')
  const usingStorage = customerAccounts.filter((account) => (account.managedStorageWorkspaceCount ?? 0) > 0)
  const storingData = customerAccounts.filter((account) => (account.managedStorageUsedBytes ?? 0) > 0)
  const paidAccounts = customerAccounts.filter((account) => account.plan && account.plan !== 'free')
  const storedBytes = customerAccounts.reduce((total, account) => total + (account.managedStorageUsedBytes ?? 0), 0)
  return (
    <SettingsSection title={copy.title} description={copy.description}>
      <div className="grid gap-px overflow-hidden rounded-sm border bg-border/70 sm:grid-cols-2 lg:grid-cols-4">
        <ValueStat label={copy.using} value={usingStorage.length} detail={copy.ofCustomerAccounts(customerAccounts.length)} />
        <ValueStat label={copy.storingData} value={storingData.length} detail={copy.storingDataDetail} />
        <ValueStat label={copy.paidPlans} value={paidAccounts.length} detail={copy.paidPlansDetail} />
        <ValueStat label={copy.dataStored} value={formatBytes(storedBytes, locale)} detail={copy.dataStoredDetail} />
      </div>
      <div>
        <h4 className="mb-3 font-heading text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{copy.planMix}</h4>
        <div className="grid gap-3 sm:grid-cols-3">
          {plans.map((plan) => {
            const planAccounts = customerAccounts.filter((account) => (account.plan ?? 'free') === plan)
            const planUsingStorage = planAccounts.filter((account) => (account.managedStorageWorkspaceCount ?? 0) > 0).length
            const planBytes = planAccounts.reduce((total, account) => total + (account.managedStorageUsedBytes ?? 0), 0)
            return (
              <div key={plan} className="rounded-sm border border-border/70 bg-background/40 p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium">{planNames[plan]}</p>
                  <p className="font-mono text-xl">{planAccounts.length}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{copy.planUsage(planUsingStorage, formatBytes(planBytes, locale))}</p>
              </div>
            )
          })}
        </div>
      </div>
    </SettingsSection>
  )
}

function ValueStat({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <div className="min-w-0 bg-card px-5 py-4">
      <p className="font-heading text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{label}</p>
      <p className="mt-2 font-mono text-2xl leading-none">{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  )
}

function SummaryCard({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <div className="rounded-sm border-2 border-border/70 bg-card/40 p-4">
      <p className="font-heading text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{label}</p>
      <p className="mt-2 font-mono text-3xl leading-none">{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  )
}
