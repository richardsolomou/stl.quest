import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { updateSelfSignupSettings } from '../../../server/fns'
import { SettingNotice, errorNotice } from '../SettingNotice'
import { SettingsSection } from './SettingsLayout'
import { useI18n } from '../../i18n'

export function SelfSignupSetting({ enabled }: { enabled: boolean }) {
  const callUpdate = useServerFn(updateSelfSignupSettings)
  const queryClient = useQueryClient()
  const copy = useI18n().t.settings.selfSignup
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
          <FieldLabel htmlFor="self-signup-enabled">{copy.label}</FieldLabel>
          <FieldDescription>{copy.description}</FieldDescription>
        </FieldContent>
        <Switch
          id="self-signup-enabled"
          checked={enabled}
          disabled={mutation.isPending}
          onCheckedChange={(checked) => mutation.mutate({ data: { enabled: checked } })}
        />
      </Field>
      {mutation.error && <SettingNotice notice={errorNotice(copy.notSaved, copy.notSavedHint, mutation.error)} />}
    </SettingsSection>
  )
}
