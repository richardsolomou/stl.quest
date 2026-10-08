import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { updateSelfSignupSettings } from '../../../server/fns'
import { SettingNotice, noticeDetail } from '../SettingNotice'
import { SettingsSection } from './SettingsLayout'

export function SelfSignupSetting({ enabled }: { enabled: boolean }) {
  const callUpdate = useServerFn(updateSelfSignupSettings)
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: callUpdate,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['session'] }),
        queryClient.invalidateQueries({ queryKey: ['auth-capabilities'] }),
      ]),
  })
  return (
    <SettingsSection>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="self-signup-enabled">Allow self-signup</FieldLabel>
          <FieldDescription>When this is off, people can only create an account from an invite link or through Add user.</FieldDescription>
        </FieldContent>
        <Switch
          id="self-signup-enabled"
          checked={enabled}
          disabled={mutation.isPending}
          onCheckedChange={(checked) => mutation.mutate({ data: { enabled: checked } })}
        />
      </Field>
      {mutation.error && (
        <SettingNotice
          notice={{
            tone: 'error',
            title: 'That preference was not saved',
            hint: 'Self-signup is still set the way it was before. Try again in a moment.',
            detail: noticeDetail(mutation.error),
          }}
        />
      )}
    </SettingsSection>
  )
}
