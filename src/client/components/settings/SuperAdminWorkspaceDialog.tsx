import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { formatBytes } from '../../../core/format'
import type { Locale } from '../../../core/i18n'
import {
  adminWorkspaceAttentionReasons,
  adminWorkspaceHealth,
  type AdminWorkspace,
  type AdminWorkspaceDetails,
  type AdminWorkspaceMember,
} from '../../../core/admin'
import { useI18n } from '../../i18n'
import { adminWorkspaceQuery, sessionQuery } from '../../queries'
import { DialogShell } from '../DialogShell'
import { ProtectedEmail } from '../ProtectedEmail'
import { QueryState } from '../QueryState'
import { SuperAdminAddMemberForm } from './SuperAdminAddMemberForm'
import { SuperAdminRemoveMemberDialog } from './SuperAdminRemoveMemberDialog'

export function SuperAdminWorkspaceDialog({ workspace, onDone }: { workspace: AdminWorkspace; onDone: () => void }) {
  const copy = useI18n().t.superAdmin.workspaceDetails
  const query = useQuery(adminWorkspaceQuery(workspace.id))
  const data = query.data
  return (
    <DialogShell title={workspace.name} description={copy.description(workspace.slug)} onClose={onDone} className="sm:max-w-[760px]">
      {!data && (
        <QueryState
          loading={query.isPending}
          error={query.error}
          loadingLabel={copy.loading}
          errorTitle={copy.loadError}
          onRetry={() => void query.refetch()}
        />
      )}
      {data && <WorkspaceDetails workspace={data} />}
    </DialogShell>
  )
}

function WorkspaceDetails({ workspace }: { workspace: AdminWorkspaceDetails }) {
  const { t, locale } = useI18n()
  const identity = useQuery(sessionQuery()).data?.identity
  const [removing, setRemoving] = useState<AdminWorkspaceMember | null>(null)
  const copy = t.superAdmin.workspaceDetails
  const formatDateTime = (value: number) => dateTime(value, locale)
  const attention = adminWorkspaceAttentionReasons(workspace, t.superAdmin)
  const storageEntries: Array<[string, string]> = [
    [
      copy.configuration,
      workspace.storageConfigured
        ? ((workspace.storageAdapter && copy.adapters[workspace.storageAdapter]) ?? t.superAdmin.configured)
        : t.superAdmin.notConfigured,
    ],
  ]
  if (workspace.managedStorage) {
    storageEntries.push(
      [copy.plan, t.settings.plan.names[workspace.managedStorage.plan]],
      [
        copy.usage,
        copy.usageOf(formatBytes(workspace.managedStorage.usedBytes, locale), formatBytes(workspace.managedStorage.quotaBytes, locale)),
      ],
    )
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {adminWorkspaceHealth(workspace) === 'attention' ? (
          <Badge variant="destructive">{t.superAdmin.health.attention}</Badge>
        ) : (
          <Badge variant="outline">{t.superAdmin.health.healthy}</Badge>
        )}
        {workspace.personal && <Badge variant="secondary">{copy.personal}</Badge>}
      </div>

      {attention.length > 0 && (
        <DetailSection title={t.superAdmin.health.attention}>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {attention.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </DetailSection>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <DetailSection title={copy.workspace}>
          <DetailList
            entries={[
              [copy.slug, workspace.slug],
              [copy.created, formatDateTime(workspace.createdAt)],
              [copy.members, String(workspace.memberCount)],
              [copy.printers, String(workspace.printerCount)],
            ]}
          />
        </DetailSection>
        <DetailSection title={copy.production}>
          <DetailList
            entries={[
              [copy.requests, String(workspace.requestCount)],
              [copy.copies, String(workspace.copyCount)],
              [copy.lastRequestChange, workspace.lastRequestAt ? formatDateTime(workspace.lastRequestAt) : t.superAdmin.noRequests],
              [copy.backgroundJobs, copy.jobCounts(workspace.activeJobCount, workspace.failedJobCount)],
            ]}
          />
        </DetailSection>
      </div>

      <DetailSection title={copy.storage}>
        <DetailList entries={storageEntries} />
      </DetailSection>

      <DetailSection title={copy.members}>
        <SuperAdminAddMemberForm workspace={workspace} />
        <div className="divide-y rounded-md border">
          {workspace.members.map((member) => (
            <div
              key={member.id}
              className="flex min-w-0 flex-col gap-2 px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{member.name}</p>
                <ProtectedEmail email={member.email} className="truncate text-xs text-muted-foreground" />
              </div>
              <div className="flex shrink-0 items-center justify-between gap-2">
                <Badge variant="secondary">{t.superAdmin.workspaceRoles[member.role]}</Badge>
                {identity?.superAdmin && member.role !== 'owner' && member.id !== identity.id && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    aria-label={copy.removeMember(member.name)}
                    onClick={() => setRemoving(member)}
                  >
                    {t.settings.members.actions.remove}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </DetailSection>
      {removing && <SuperAdminRemoveMemberDialog workspaceId={workspace.id} member={removing} onDone={() => setRemoving(null)} />}
    </div>
  )
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="font-heading text-sm font-semibold tracking-wide uppercase">{title}</h3>
      {children}
    </section>
  )
}

function DetailList({ entries }: { entries: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-2 text-sm [&_dt]:text-muted-foreground [&_dd]:m-0">
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
