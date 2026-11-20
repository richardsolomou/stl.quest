import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Activity } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { updateTelemetrySettings } from '../../../server/fns'
import { telemetryQuery } from '../../queries'
import { LATEST_DOCUMENTATION_URL } from '../../sourceCode'
import { QueryState } from '../QueryState'
import { SettingRow } from '../SettingRow'
import { SettingNotice, errorNotice } from '../SettingNotice'
import { PageHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { useI18n } from '../../i18n'

export function TelemetryPane() {
  const query = useQuery(telemetryQuery())
  const current = query.data
  const callUpdate = useServerFn(updateTelemetrySettings)
  const queryClient = useQueryClient()
  const copy = useI18n().t.settings.telemetry
  // The switch itself reports the saved state, so success needs no announcement — only a failure does.
  const mutation = useMutation({
    mutationFn: callUpdate,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['telemetry'] }),
  })
  if (!current) {
    return (
      <SettingsPage>
        <PageHeader title={copy.title} description={copy.loadingDescription} />
        <QueryState
          loading={query.isPending}
          error={query.error}
          loadingLabel={copy.loading}
          errorTitle={copy.loadError}
          onRetry={() => void query.refetch()}
        />
      </SettingsPage>
    )
  }

  return (
    <SettingsPage>
      <PageHeader title={copy.title} description={copy.description} />
      <SettingsSection
        title={copy.usage.title}
        description={
          <>
            {copy.usage.description}{' '}
            <a
              className="font-medium text-foreground underline underline-offset-2"
              href={`${LATEST_DOCUMENTATION_URL}/telemetry.md`}
              target="_blank"
              rel="noreferrer"
            >
              {copy.usage.docs}
            </a>
          </>
        }
      >
        <SettingRow
          icon={<Activity />}
          name={copy.label}
          status={{ label: current.enabled ? copy.on : copy.off, tone: current.enabled ? 'on' : 'off' }}
          detail={copy.hint}
          actions={
            <Switch
              aria-label={copy.label}
              checked={current.enabled}
              disabled={mutation.isPending}
              onCheckedChange={(enabled) => mutation.mutate({ data: { enabled } })}
            />
          }
        />
        {mutation.error && <SettingNotice notice={errorNotice(copy.notSaved, copy.notSavedHint, mutation.error)} />}
      </SettingsSection>
    </SettingsPage>
  )
}
