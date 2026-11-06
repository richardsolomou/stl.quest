import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { updateTelemetrySettings } from '../../../server/fns'
import { telemetryQuery } from '../../queries'
import { QueryState } from '../QueryState'
import { SettingNotice, noticeDetail } from '../SettingNotice'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'
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
        <SettingsHeader title={copy.title} description={copy.loadingDescription} />
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
      <SettingsHeader title={copy.title} description={copy.description} />
      <SettingsSection>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="telemetry-enabled">{copy.label}</FieldLabel>
            <FieldDescription>{copy.hint}</FieldDescription>
          </FieldContent>
          <Switch
            id="telemetry-enabled"
            checked={current.enabled}
            disabled={mutation.isPending}
            onCheckedChange={(enabled) => mutation.mutate({ data: { enabled } })}
          />
        </Field>
        {mutation.error && (
          <SettingNotice
            notice={{
              tone: 'error',
              title: copy.notSaved,
              hint: copy.notSavedHint,
              detail: noticeDetail(mutation.error),
            }}
          />
        )}
      </SettingsSection>
    </SettingsPage>
  )
}
