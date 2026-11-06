import { useQuery } from '@tanstack/react-query'
import { systemDiagnosticsQuery } from '../../queries'
import { QueryState } from '../QueryState'
import { formatBytes } from '../../../core/format'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { useI18n } from '../../i18n'

export function SystemDiagnosticsPane({ embedded = false }: { embedded?: boolean }) {
  const query = useQuery(systemDiagnosticsQuery())
  const data = query.data
  const { t, locale } = useI18n()
  const copy = t.settings.systemDiagnostics
  const content = (
    <SettingsSection title={embedded ? copy.embeddedTitle : undefined}>
      {!data && (
        <QueryState
          loading={query.isPending}
          error={query.error}
          loadingLabel={t.settings.diagnostics.loading}
          errorTitle={copy.loadError}
          onRetry={() => void query.refetch()}
        />
      )}
      {data && (
        <dl className="grid grid-cols-[minmax(9rem,auto)_1fr] gap-x-4 gap-y-2.5 max-sm:grid-cols-1 [&_dt]:text-muted-foreground [&_dd]:m-0">
          <dt>{copy.version}</dt>
          <dd>{data.version}</dd>
          <dt>{copy.authentication}</dt>
          <dd>
            {[data.authentication.password && copy.password, ...data.authentication.socialProviders].filter(Boolean).join(', ') ||
              copy.none}
          </dd>
          <dt>{copy.email}</dt>
          <dd>{data.authentication.smtpConfigured ? copy.configured : copy.notConfigured}</dd>
          <dt>{copy.database}</dt>
          <dd>
            {data.database.location.kind === 'local'
              ? formatBytes(data.database.location.sizeBytes, locale)
              : data.database.location.display}{' '}
            · {copy.integrity(data.database.integrity)}
          </dd>
          <dt>{copy.diskFree}</dt>
          <dd>{data.dataCapacity ? formatBytes(data.dataCapacity.freeBytes, locale) : t.settings.diagnostics.notApplicable}</dd>
        </dl>
      )}
    </SettingsSection>
  )
  if (embedded) return content
  return (
    <SettingsPage>
      <SettingsHeader title={copy.title} description={copy.description} />
      {content}
    </SettingsPage>
  )
}
