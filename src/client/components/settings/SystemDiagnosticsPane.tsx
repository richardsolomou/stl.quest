import { useQuery } from '@tanstack/react-query'
import { systemDiagnosticsQuery } from '../../queries'
import { QueryState } from '../QueryState'
import { formatBytes } from './DiagnosticsPane'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'

export function SystemDiagnosticsPane({ embedded = false }: { embedded?: boolean }) {
  const query = useQuery(systemDiagnosticsQuery())
  const data = query.data
  const content = (
    <SettingsSection title={embedded ? 'System health' : undefined}>
      {!data && (
        <QueryState
          loading={query.isPending}
          error={query.error}
          loadingLabel="Checking system health…"
          errorTitle="Could not load system diagnostics"
          onRetry={() => void query.refetch()}
        />
      )}
      {data && (
        <dl className="grid grid-cols-[minmax(9rem,auto)_1fr] gap-x-4 gap-y-2.5 max-sm:grid-cols-1 [&_dt]:text-muted-foreground [&_dd]:m-0">
          <dt>Version</dt>
          <dd>{data.version}</dd>
          <dt>Authentication</dt>
          <dd>
            {[data.authentication.password && 'password', ...data.authentication.socialProviders].filter(Boolean).join(', ') || 'none'}
          </dd>
          <dt>Email</dt>
          <dd>{data.authentication.smtpConfigured ? 'configured' : 'not configured'}</dd>
          <dt>Database</dt>
          <dd>
            {formatBytes(data.database.sizeBytes)} · integrity {data.database.integrity}
          </dd>
          <dt>Data disk free</dt>
          <dd>{data.dataCapacity ? formatBytes(data.dataCapacity.freeBytes) : 'n/a'}</dd>
        </dl>
      )}
    </SettingsSection>
  )
  if (embedded) return content
  return (
    <SettingsPage>
      <SettingsHeader title="System diagnostics" description="Inspect deployment, authentication, database, and data-disk health." />
      {content}
    </SettingsPage>
  )
}
