import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { notificationKinds } from '../../../core/notifications'
import { updateNotificationPreference } from '../../../server/fns'
import { notificationPreferencesQuery } from '../../queries'
import { QueryState } from '../QueryState'
import { SettingNotice, noticeDetail } from '../SettingNotice'
import { SettingsSection } from './SettingsLayout'

export function AccountNotifications({
  workspaceSlug,
  workspaceName,
  emailConfigured,
}: {
  workspaceSlug: string
  workspaceName: string
  emailConfigured: boolean
}) {
  const query = useQuery(notificationPreferencesQuery(workspaceSlug))
  const callUpdate = useServerFn(updateNotificationPreference)
  const queryClient = useQueryClient()
  // The switch reports the saved state, so only a failure needs a notice.
  const mutation = useMutation({
    mutationFn: callUpdate,
    onSuccess: (preferences) => queryClient.setQueryData(notificationPreferencesQuery(workspaceSlug).queryKey, preferences),
  })
  const preferences = query.data
  return (
    <SettingsSection
      title="Email notifications"
      description={
        emailConfigured
          ? `Choose which emails you receive from ${workspaceName}.`
          : `Email delivery is not set up on this server yet. Your choices for ${workspaceName} apply once it is.`
      }
    >
      {!preferences ? (
        <QueryState
          loading={query.isPending}
          error={query.error}
          loadingLabel="Loading notification settings…"
          errorTitle="Could not load notification settings"
          onRetry={() => void query.refetch()}
        />
      ) : (
        notificationKinds.map((kind) => (
          <Field key={kind.id} orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor={`notification-${kind.id}`}>{kind.name}</FieldLabel>
              <FieldDescription>{kind.description}</FieldDescription>
            </FieldContent>
            <Switch
              id={`notification-${kind.id}`}
              checked={preferences[kind.id]}
              disabled={mutation.isPending}
              onCheckedChange={(enabled) => mutation.mutate({ data: { workspaceSlug, kind: kind.id, enabled } })}
            />
          </Field>
        ))
      )}
      {mutation.error && (
        <SettingNotice
          notice={{
            tone: 'error',
            title: 'That preference was not saved',
            hint: 'Your notifications are still set the way they were before. Try again in a moment.',
            detail: noticeDetail(mutation.error),
          }}
        />
      )}
    </SettingsSection>
  )
}
