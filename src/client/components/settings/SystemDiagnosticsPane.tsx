import { useQuery } from '@tanstack/react-query'
import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { systemDiagnosticsQuery } from '../../queries'
import { formatBytes } from './DiagnosticsPane'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'

export function SystemDiagnosticsPane({ embedded = false }: { embedded?: boolean }) {
  const { data, error } = useQuery(systemDiagnosticsQuery())
  const content = (
    <SettingsSection title={embedded ? 'System health' : undefined}>
      {!data && !error && (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Spinner /> Checking system health…
        </p>
      )}
      {error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
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
