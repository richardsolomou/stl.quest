import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { notificationKinds } from '../../../core/notifications'
import { updateNotificationPreference } from '../../../server/fns'
import { useI18n } from '../../i18n'
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
  const { t } = useI18n()
  const copy = t.account.notifications
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
    <SettingsSection title={copy.title} description={emailConfigured ? copy.description(workspaceName) : copy.notConfigured(workspaceName)}>
      {!preferences ? (
        <QueryState
          loading={query.isPending}
          error={query.error}
          loadingLabel={copy.loading}
          errorTitle={copy.loadFailed}
          onRetry={() => void query.refetch()}
        />
      ) : (
        notificationKinds.map((kind) => (
          <Field key={kind.id} orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor={`notification-${kind.id}`}>{copy.kinds[kind.id].name}</FieldLabel>
              <FieldDescription>{copy.kinds[kind.id].description}</FieldDescription>
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
            title: copy.saveFailedTitle,
            hint: copy.saveFailedHint,
            detail: noticeDetail(mutation.error),
          }}
        />
      )}
    </SettingsSection>
  )
}
