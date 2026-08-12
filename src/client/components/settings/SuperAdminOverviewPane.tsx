import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatBytes } from '../../../core/format'
import { adminWorkspaceAttentionReasons, type AdminWorkspace } from '../../../core/admin'
import { accountsQuery, adminWorkspacesQuery } from '../../queries'
import { QueryState } from '../QueryState'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { SuperAdminWorkspaceDialog } from './SuperAdminWorkspaceDialog'

const DAY = 24 * 60 * 60 * 1_000

export function SuperAdminOverviewPane() {
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
  const managedBytes = workspaces.reduce((total, workspace) => total + (workspace.managedStorage?.usedBytes ?? 0), 0)
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
        <SummaryCard label="Print requests" value={requests} detail={`${copies} current copies`} />
        <SummaryCard label="Managed storage" value={formatBytes(managedBytes)} detail="Across included-storage workspaces" />
        <SummaryCard
          label="Needs attention"
          value={attention.length}
          detail={attention.length ? 'Storage or background processing needs review' : 'No known workspace problems'}
        />
      </div>

      <SettingsSection
        title="Needs attention"
        description="Read-only checks for missing storage, failed background jobs, and included-storage capacity."
        className="px-0 pb-0"
      >
        {attention.length ? (
          <div className="divide-y border-t">
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
          <p className="px-5 pb-5 text-sm text-muted-foreground">Every workspace passes the available checks.</p>
        )}
      </SettingsSection>
      {selected && <SuperAdminWorkspaceDialog workspace={selected} onDone={() => setSelected(undefined)} />}
    </SettingsPage>
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
