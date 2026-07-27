import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { updateTelemetrySettings } from '../../../server/fns'
import { telemetryQuery } from '../../queries'
import { QueryState } from '../QueryState'
import { SettingNotice, noticeDetail } from '../SettingNotice'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'

export function TelemetryPane() {
  const query = useQuery(telemetryQuery())
  const current = query.data
  const callUpdate = useServerFn(updateTelemetrySettings)
  const queryClient = useQueryClient()
  // The switch itself reports the saved state, so success needs no announcement — only a failure does.
  const mutation = useMutation({
    mutationFn: callUpdate,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['telemetry'] }),
  })
  if (!current) {
    return (
      <SettingsPage>
        <SettingsHeader title="Telemetry" description="Control anonymous usage reporting." />
        <QueryState
          loading={query.isPending}
          error={query.error}
          loadingLabel="Loading telemetry settings…"
          errorTitle="Could not load telemetry settings"
          onRetry={() => void query.refetch()}
        />
      </SettingsPage>
    )
  }

  return (
    <SettingsPage>
      <SettingsHeader
        title="Telemetry"
        description="STL Quest sends anonymous usage events to help improve the app. Model geometry, request details, names, and email addresses are never included."
      />
      <SettingsSection>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="telemetry-enabled">Share anonymous usage data</FieldLabel>
            <FieldDescription>Enabled by default and can be disabled at any time.</FieldDescription>
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
              title: 'That preference was not saved',
              hint: 'Telemetry is still set the way it was before. Try again in a moment.',
              detail: noticeDetail(mutation.error),
            }}
          />
        )}
      </SettingsSection>
    </SettingsPage>
  )
}
