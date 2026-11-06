import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { SOCIAL_AUTH_PROVIDER_NAMES, SOCIAL_AUTH_PROVIDERS, type SocialAuthProvider } from '../../../core/auth'
import type { Locale, Messages } from '../../../core/i18n'
import type { Account } from '../../../core/types'
import type { AdminAccountDetails } from '../../../core/admin'
import { formatBytes } from '../../../core/format'
import { storagePlans } from '../../../core/plans'
import { useI18n } from '../../i18n'
import { adminAccountQuery } from '../../queries'
import { DialogShell } from '../DialogShell'
import { QueryState } from '../QueryState'
import { UserSummary } from '../UserSummary'
import { roleLabel } from './SuperAdminAccessDialogs'

export function SuperAdminUserDetailDialog({ user, hosted, onDone }: { user: Account; hosted: boolean; onDone: () => void }) {
  const { t } = useI18n()
  const copy = t.superAdmin.userDetails
  const query = useQuery(adminAccountQuery(user.id))
  return (
    <DialogShell title={user.name} description={copy.description} onClose={onDone} className="sm:max-w-[800px]">
      {!query.data && (
        <QueryState
          loading={query.isPending}
          error={query.error}
          loadingLabel={copy.loading}
          errorTitle={copy.loadError}
          onRetry={() => void query.refetch()}
        />
      )}
      {query.data && <AccountDetails account={query.data} hosted={hosted} />}
    </DialogShell>
  )
}

function AccountDetails({ account, hosted }: { account: AdminAccountDetails; hosted: boolean }) {
  const { t, locale } = useI18n()
  const copy = t.superAdmin.userDetails
  const formatDateTime = (value: number) => dateTime(value, locale)
  const planEntries: Array<[string, string]> = []
  if (hosted) {
    const plan = account.plan ?? 'free'
    const usedBytes = account.managedStorageUsedBytes ?? 0
    const quotaBytes = account.managedStorageQuotaBytes ?? storagePlans[plan].quotaBytes
    const managedWorkspaces = account.managedStorageWorkspaceCount ?? 0
    planEntries.push(
      [copy.plan, t.settings.plan.names[plan]],
      [
        copy.includedStorage,
        managedWorkspaces
          ? copy.includedStorageUsage(formatBytes(usedBytes, locale), formatBytes(quotaBytes, locale), managedWorkspaces)
          : t.superAdmin.notInUse,
      ],
    )
  }
  if (hosted && account.subscription) {
    planEntries.push(
      [copy.subscription, copy.subscriptionStatus[account.subscription.status] ?? titleCase(account.subscription.status)],
      [
        copy.billingInterval,
        account.subscription.billingInterval
          ? (copy.billingIntervals[account.subscription.billingInterval] ?? titleCase(account.subscription.billingInterval))
          : copy.unknown,
      ],
      [
        copy.renewsOrEnds,
        account.subscription.cancelAt
          ? formatDateTime(account.subscription.cancelAt)
          : account.subscription.periodEnd
            ? formatDateTime(account.subscription.periodEnd)
            : copy.notAvailable,
      ],
    )
  }
  return (
    <div className="space-y-5">
      <UserSummary user={account} role={roleLabel(account, t)} />
      <div className="grid gap-6 md:grid-cols-2">
        <DetailSection title={copy.account}>
          <DetailList
            entries={[
              [copy.accountId, account.id],
              [copy.created, formatDateTime(account.createdAt)],
              [copy.updated, formatDateTime(account.updatedAt)],
              [copy.lastOnline, account.lastOnlineAt ? formatDateTime(account.lastOnlineAt) : t.superAdmin.never],
            ]}
          />
        </DetailSection>
        <DetailSection title={copy.security}>
          <DetailList
            entries={[
              [copy.email, account.emailVerified ? copy.verified : copy.notVerified],
              [copy.twoFactor, account.twoFactorEnabled ? copy.enabled : copy.notEnabled],
              [
                copy.signInMethods,
                account.authProviders.length
                  ? account.authProviders.map((provider) => authProviderLabel(provider, t)).join(', ')
                  : t.common.none,
              ],
            ]}
          />
        </DetailSection>
      </div>

      {planEntries.length > 0 && (
        <DetailSection title={copy.planAndStorage}>
          <DetailList entries={planEntries} />
        </DetailSection>
      )}

      <DetailSection title={copy.workspaces(account.workspaces.length)}>
        {account.workspaces.length ? (
          <div className="divide-y rounded-md border">
            {account.workspaces.map((workspace) => (
              <div key={workspace.id} className="flex min-w-0 items-center justify-between gap-4 px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{workspace.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{workspace.slug}</p>
                </div>
                <Badge variant="secondary">{t.superAdmin.workspaceRoles[workspace.role]}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{copy.noWorkspaces}</p>
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

function dateTime(value: number, locale: Locale) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
}

function authProviderLabel(provider: string, t: Messages) {
  if (provider === 'credential') return t.superAdmin.userDetails.password
  if (SOCIAL_AUTH_PROVIDERS.includes(provider as SocialAuthProvider)) return SOCIAL_AUTH_PROVIDER_NAMES[provider as SocialAuthProvider]
  return titleCase(provider)
}

function titleCase(value: string) {
  return value
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}
