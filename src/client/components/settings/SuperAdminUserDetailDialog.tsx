import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import type { Account } from '../../../core/types'
import type { AdminAccountDetails } from '../../../core/admin'
import { formatBytes } from '../../../core/format'
import { adminAccountQuery } from '../../queries'
import { DialogShell } from '../DialogShell'
import { QueryState } from '../QueryState'
import { UserSummary } from '../UserSummary'

export function SuperAdminUserDetailDialog({ user, onDone }: { user: Account; onDone: () => void }) {
  const query = useQuery(adminAccountQuery(user.id))
  return (
    <DialogShell title={user.name} description="Deployment-wide account details" onClose={onDone} className="sm:max-w-[800px]">
      {!query.data && (
        <QueryState
          loading={query.isPending}
          error={query.error}
          loadingLabel="Loading account details…"
          errorTitle="Could not load account details"
          onRetry={() => void query.refetch()}
        />
      )}
      {query.data && <AccountDetails account={query.data} />}
    </DialogShell>
  )
}

function AccountDetails({ account }: { account: AdminAccountDetails }) {
  const planEntries: Array<[string, string]> = []
  if (account.managedStorage) {
    planEntries.push(
      ['Plan', titleCase(account.managedStorage.plan)],
      ['Storage usage', `${formatBytes(account.managedStorage.usedBytes)} of ${formatBytes(account.managedStorage.quotaBytes)}`],
    )
  }
  if (account.subscription) {
    planEntries.push(
      ['Subscription', titleCase(account.subscription.status)],
      ['Billing interval', account.subscription.billingInterval ? titleCase(account.subscription.billingInterval) : 'Unknown'],
      [
        'Renews or ends',
        account.subscription.cancelAt
          ? formatDateTime(account.subscription.cancelAt)
          : account.subscription.periodEnd
            ? formatDateTime(account.subscription.periodEnd)
            : 'Not available',
      ],
    )
  }
  return (
    <div className="space-y-5">
      <UserSummary user={account} role={account.role === 'super_admin' ? 'Super admin' : 'User'} />
      <div className="grid gap-6 md:grid-cols-2">
        <DetailSection title="Account">
          <DetailList
            entries={[
              ['Account ID', account.id],
              ['Created', formatDateTime(account.createdAt)],
              ['Updated', formatDateTime(account.updatedAt)],
              ['Last online', account.lastOnlineAt ? formatDateTime(account.lastOnlineAt) : 'Never'],
            ]}
          />
        </DetailSection>
        <DetailSection title="Security">
          <DetailList
            entries={[
              ['Email', account.emailVerified ? 'Verified' : 'Not verified'],
              ['Two-factor authentication', account.twoFactorEnabled ? 'Enabled' : 'Not enabled'],
              ['Sign-in methods', account.authProviders.length ? account.authProviders.map(authProviderLabel).join(', ') : 'None'],
            ]}
          />
        </DetailSection>
      </div>

      {planEntries.length > 0 && (
        <DetailSection title="Plan and included storage">
          <DetailList entries={planEntries} />
        </DetailSection>
      )}

      <DetailSection title={`Workspaces (${account.workspaces.length})`}>
        {account.workspaces.length ? (
          <div className="divide-y rounded-md border">
            {account.workspaces.map((workspace) => (
              <div key={workspace.id} className="flex min-w-0 items-center justify-between gap-4 px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{workspace.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{workspace.slug}</p>
                </div>
                <Badge variant="secondary">{workspaceRoleLabel(workspace.role)}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">This account does not belong to a workspace.</p>
        )}
      </DetailSection>
    </div>
  )
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-2">
      <h3 className="font-heading text-sm font-semibold tracking-wide uppercase">{title}</h3>
      {children}
    </section>
  )
}

function DetailList({ entries }: { entries: Array<[string, string]> }) {
  return (
    <dl className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] gap-x-4 gap-y-2 text-sm [&_dd]:m-0 [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere] [&_dt]:min-w-0 [&_dt]:text-muted-foreground">
      {entries.map(([label, value]) => (
        <div key={label} className="contents">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function formatDateTime(value: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
}

function authProviderLabel(provider: string) {
  if (provider === 'credential') return 'Password'
  if (provider === 'google') return 'Google'
  if (provider === 'discord') return 'Discord'
  return titleCase(provider)
}

function workspaceRoleLabel(role: string) {
  if (role === 'owner') return 'Owner'
  if (role === 'admin') return 'Admin'
  return 'Member'
}

function titleCase(value: string) {
  return value
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}
