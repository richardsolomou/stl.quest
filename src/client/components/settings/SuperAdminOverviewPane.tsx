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
import { accountsQuery, adminWorkspacesQuery } from '../../queries'
import { QueryState } from '../QueryState'
import { SettingsHeader, SettingsPage } from './SettingsLayout'
import { SuperAdminWorkspaceDialog } from './SuperAdminWorkspaceDialog'

const DAY = 24 * 60 * 60 * 1_000

export function SuperAdminOverviewPane({ hosted }: { hosted: boolean }) {
  const accountsResult = useQuery(accountsQuery())
  const workspacesResult = useQuery(adminWorkspacesQuery())
  const [selected, setSelected] = useState<AdminWorkspace>()
  const accounts = accountsResult.data
  const workspaces = workspacesResult.data

  if (!accounts || !workspaces) {
    return (
      <SettingsPage>
        <SettingsHeader title="Overview" description="See deployment growth, production usage, and workspaces that need attention." />
        <QueryState
          loading={accountsResult.isPending || workspacesResult.isPending}
          error={accountsResult.error ?? workspacesResult.error}
          loadingLabel="Loading deployment overview…"
          errorTitle="Could not load deployment overview"
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
    .map((workspace) => ({ workspace, reasons: adminWorkspaceAttentionReasons(workspace) }))
    .filter(({ reasons }) => reasons.length)
    .sort((left, right) => right.reasons.length - left.reasons.length || left.workspace.name.localeCompare(right.workspace.name))

  return (
    <SettingsPage>
      <SettingsHeader title="Overview" description="See deployment growth, production usage, and workspaces that need attention." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryCard label="Users" value={accounts.length} detail={`${newAccounts} new in the last 30 days`} />
        <SummaryCard label="Active users" value={activeAccounts} detail="Approximate, from sessions in the last 30 days" />
        <SummaryCard label="Workspaces" value={workspaces.length} detail={`${newWorkspaces} new in the last 30 days`} />
        <SummaryCard label="Print requests" value={requests} detail="Current requests across all workspaces" />
        <SummaryCard label="Print copies" value={copies} detail="Current copies across all workflow stages" />
        <SummaryCard
          label="Needs attention"
          value={attention.length}
          detail={attention.length ? 'Storage or background processing needs review' : 'No known workspace problems'}
        />
      </div>

      {hosted && <HostedStorageValue accounts={accounts} />}

      <section className="overflow-hidden rounded-sm border-2 border-border/70 bg-card/40">
        <header className="space-y-1 border-b-2 border-dashed border-blueprint/25 px-5 py-4">
          <h3 className="font-heading text-base font-semibold tracking-tight">Needs attention</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Read-only checks for missing storage, failed background jobs, and included-storage capacity.
          </p>
        </header>
        {attention.length ? (
          <div className="divide-y">
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
                <Badge variant="destructive">Review</Badge>
              </Button>
            ))}
          </div>
        ) : (
          <Empty className="min-h-36 rounded-none border-0 p-6">
            <EmptyMedia variant="icon">
              <CircleCheck />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>All workspaces look healthy</EmptyTitle>
              <EmptyDescription>Every workspace passes the available checks.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>
      {selected && <SuperAdminWorkspaceDialog workspace={selected} onDone={() => setSelected(undefined)} />}
    </SettingsPage>
  )
}

function HostedStorageValue({ accounts }: { accounts: Account[] }) {
  const plans = Object.keys(storagePlans) as StoragePlan[]
  const customerAccounts = accounts.filter((account) => account.role !== 'super_admin')
  const usingStorage = customerAccounts.filter((account) => (account.managedStorageWorkspaceCount ?? 0) > 0)
  const storingData = customerAccounts.filter((account) => (account.managedStorageUsedBytes ?? 0) > 0)
  const paidAccounts = customerAccounts.filter((account) => account.plan && account.plan !== 'free')
  const storedBytes = customerAccounts.reduce((total, account) => total + (account.managedStorageUsedBytes ?? 0), 0)
  return (
    <section className="overflow-hidden rounded-sm border-2 border-border/70 bg-card/40">
      <header className="space-y-1 border-b-2 border-dashed border-blueprint/25 px-5 py-4">
        <h3 className="font-heading text-base font-semibold tracking-tight">Hosted storage value</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          See who has adopted included storage, who is actively storing data, and how usage differs by plan.
        </p>
      </header>
      <div className="grid gap-px bg-border/70 sm:grid-cols-2 lg:grid-cols-4">
        <ValueStat
          label="Using included storage"
          value={usingStorage.length}
          detail={`of ${customerAccounts.length} customer ${customerAccounts.length === 1 ? 'account' : 'accounts'}`}
        />
        <ValueStat label="Storing data" value={storingData.length} detail="accounts with stored models or generated assets" />
        <ValueStat label="Paid plans" value={paidAccounts.length} detail="active Supporter or Pro accounts" />
        <ValueStat label="Data stored" value={formatBytes(storedBytes)} detail="across customer accounts" />
      </div>
      <div className="border-t-2 border-dashed border-blueprint/25 px-5 py-4">
        <h4 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Plan mix</h4>
        <div className="grid gap-3 sm:grid-cols-3">
          {plans.map((plan) => {
            const planAccounts = customerAccounts.filter((account) => (account.plan ?? 'free') === plan)
            const planUsingStorage = planAccounts.filter((account) => (account.managedStorageWorkspaceCount ?? 0) > 0).length
            const planBytes = planAccounts.reduce((total, account) => total + (account.managedStorageUsedBytes ?? 0), 0)
            return (
              <div key={plan} className="rounded-sm border border-border/70 bg-background/40 p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium">{storagePlans[plan].name}</p>
                  <p className="font-heading text-xl font-semibold tabular-nums">{planAccounts.length}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {planUsingStorage} using storage · {formatBytes(planBytes)} stored
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function ValueStat({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <div className="min-w-0 bg-card px-5 py-4">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-2 font-heading text-2xl leading-none font-semibold tabular-nums">{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  )
}

function SummaryCard({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <div className="rounded-sm border-2 border-border/70 bg-card/40 p-4">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-2 font-heading text-3xl leading-none font-semibold tabular-nums">{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  )
}
