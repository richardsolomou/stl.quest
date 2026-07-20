import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { updateTelemetrySettings } from '../../../server/fns'
import { telemetryQuery } from '../../queries'
import { QueryState } from '../QueryState'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'

export function TelemetryPane() {
  const query = useQuery(telemetryQuery())
  const current = query.data
  const callUpdate = useServerFn(updateTelemetrySettings)
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: callUpdate,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['telemetry'] })
      toast.success('Telemetry settings saved.')
    },
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
        description="PrintHub sends anonymous usage events to help improve the app. Model geometry, request details, names, and email addresses are never included."
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
        <FieldError>{mutation.error?.message || (mutation.error ? 'Could not save telemetry settings.' : null)}</FieldError>
      </SettingsSection>
    </SettingsPage>
  )
}
