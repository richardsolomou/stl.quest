import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { formatBytes } from '../../../core/format'
import { adminWorkspaceAttentionReasons, adminWorkspaceHealth, type AdminWorkspace, type AdminWorkspaceDetails } from '../../../core/admin'
import { adminWorkspaceQuery } from '../../queries'
import { DialogShell } from '../DialogShell'
import { ProtectedEmail } from '../ProtectedEmail'
import { QueryState } from '../QueryState'

export function SuperAdminWorkspaceDialog({ workspace, onDone }: { workspace: AdminWorkspace; onDone: () => void }) {
  const query = useQuery(adminWorkspaceQuery(workspace.id))
  const data = query.data
  return (
    <DialogShell
      title={workspace.name}
      description={`Deployment-wide details for ${workspace.slug}`}
      onClose={onDone}
      className="sm:max-w-[760px]"
    >
      {!data && (
        <QueryState
          loading={query.isPending}
          error={query.error}
          loadingLabel="Loading workspace details…"
          errorTitle="Could not load workspace details"
          onRetry={() => void query.refetch()}
        />
      )}
      {data && <WorkspaceDetails workspace={data} />}
    </DialogShell>
  )
}

function WorkspaceDetails({ workspace }: { workspace: AdminWorkspaceDetails }) {
  const attention = adminWorkspaceAttentionReasons(workspace)
  const storageEntries: Array<[string, string]> = [
    ['Configuration', workspace.storageConfigured ? storageAdapterLabel(workspace.storageAdapter) : 'Not configured'],
  ]
  if (workspace.managedStorage) {
    storageEntries.push(
      ['Plan', workspace.managedStorage.plan[0].toUpperCase() + workspace.managedStorage.plan.slice(1)],
      ['Usage', `${formatBytes(workspace.managedStorage.usedBytes)} of ${formatBytes(workspace.managedStorage.quotaBytes)}`],
    )
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {adminWorkspaceHealth(workspace) === 'attention' ? (
          <Badge variant="destructive">Needs attention</Badge>
        ) : (
          <Badge variant="outline">Healthy</Badge>
        )}
        {workspace.personal && <Badge variant="secondary">Personal workspace</Badge>}
      </div>

      {attention.length > 0 && (
        <DetailSection title="Needs attention">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {attention.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </DetailSection>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <DetailSection title="Workspace">
          <DetailList
            entries={[
              ['Slug', workspace.slug],
              ['Created', formatDateTime(workspace.createdAt)],
              ['Members', String(workspace.memberCount)],
              ['Printers', String(workspace.printerCount)],
            ]}
          />
        </DetailSection>
        <DetailSection title="Production">
          <DetailList
            entries={[
              ['Requests', String(workspace.requestCount)],
              ['Copies', String(workspace.copyCount)],
              ['Last request change', workspace.lastRequestAt ? formatDateTime(workspace.lastRequestAt) : 'No requests'],
              ['Background jobs', `${workspace.activeJobCount} active · ${workspace.failedJobCount} failed`],
            ]}
          />
        </DetailSection>
      </div>

      <DetailSection title="Storage">
        <DetailList entries={storageEntries} />
      </DetailSection>

      <DetailSection title="Members">
        <div className="divide-y rounded-md border">
          {workspace.members.map((member) => (
            <div key={member.id} className="flex min-w-0 items-center justify-between gap-4 px-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{member.name}</p>
                <ProtectedEmail email={member.email} className="truncate text-xs text-muted-foreground" />
              </div>
              <Badge variant="secondary">{workspaceRoleLabel(member.role)}</Badge>
            </div>
          ))}
        </div>
      </DetailSection>
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

function formatDateTime(value: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
}

function storageAdapterLabel(adapter?: string) {
  if (!adapter) return 'Configured'
  const labels: Record<string, string> = {
    local: 'Local folder',
    s3: 'S3-compatible storage',
    webdav: 'WebDAV',
    dropbox: 'Dropbox',
    'google-drive': 'Google Drive',
    onedrive: 'OneDrive',
    box: 'Box',
    managed: 'Included storage',
  }
  return labels[adapter] ?? 'Configured'
}

function workspaceRoleLabel(role: string) {
  if (role === 'owner') return 'Owner'
  if (role === 'admin') return 'Admin'
  return 'Member'
}
