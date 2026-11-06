import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import type { PublicIntegrationConfig, PublicSmtpConfig } from '../../../core/auth'
import { removeSmtpSettings, saveSmtpSettings } from '../../../server/fns'
import { invalidateQueries } from '../../queryState'
import { AuthMethodIcon } from '../AuthMethodIcon'
import { DialogProblem } from '../DialogProblem'
import { DialogShell } from '../DialogShell'
import { SettingRow } from '../SettingRow'
import { SettingsSection } from './SettingsLayout'
import { useI18n } from '../../i18n'

export function SmtpSettings({ data, onConfigure }: { data: PublicIntegrationConfig; onConfigure: () => void }) {
  const { t } = useI18n()
  const copy = t.settings.smtp
  return (
    <SettingsSection title={copy.title} description={copy.description}>
      <SettingRow
        icon={<AuthMethodIcon method="smtp" />}
        name="SMTP"
        status={{ label: data.smtp.configured ? copy.sending : copy.notSetUp, tone: data.smtp.configured ? 'on' : 'off' }}
        detail={data.smtp.configured ? copy.sentFrom(data.smtp.from) : copy.connectHint}
        actions={
          <Button type="button" variant="outline" size="sm" onClick={onConfigure}>
            {data.smtp.configured ? t.common.edit : copy.setUp}
          </Button>
        }
      />
    </SettingsSection>
  )
}

export function DeploymentSmtpDialog({ current, onDone }: { current: PublicIntegrationConfig; onDone: () => void }) {
  const queryClient = useQueryClient()
  const callSave = useServerFn(saveSmtpSettings)
  const callRemove = useServerFn(removeSmtpSettings)
  const refresh = () => invalidateQueries(queryClient, 'integrations', 'session')
  return (
    <SmtpDialog
      smtp={current.smtp}
      save={async (data) => {
        await callSave({ data })
        await refresh()
      }}
      remove={async () => {
        await callRemove({})
        await refresh()
      }}
      onDone={onDone}
    />
  )
}

export type SmtpValues = { from: string; host: string; port: number; secure: boolean; user?: string; password?: string }

export function SmtpDialog({
  smtp,
  hint,
  save,
  remove,
  onDone,
}: {
  smtp: PublicSmtpConfig
  hint?: string
  save: (values: SmtpValues) => Promise<void>
  remove: () => Promise<void>
  onDone: () => void
}) {
  const [values, setValues] = useState({
    from: smtp.from,
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    user: smtp.user ?? '',
    password: '',
  })
  const { t } = useI18n()
  const copy = t.settings.smtp.dialog
  const saveMutation = useMutation({ mutationFn: save, onSuccess: onDone })
  const removeMutation = useMutation({ mutationFn: remove, onSuccess: onDone })
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => setValues((state) => ({ ...state, [key]: value }))
  return (
    <DialogShell open title={smtp.configured ? copy.editTitle : copy.configureTitle} onClose={onDone}>
      <p className="text-sm leading-relaxed text-muted-foreground">{copy.description}</p>
      <FieldSet>
        <FieldLegend>{copy.server}</FieldLegend>
        <Field>
          <FieldLabel htmlFor="smtp-from">{copy.fromLabel}</FieldLabel>
          <Input
            id="smtp-from"
            value={values.from}
            placeholder={copy.fromPlaceholder}
            onChange={(event) => set('from', event.target.value)}
          />
          <FieldDescription>{copy.fromHint}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="smtp-host">{copy.hostLabel}</FieldLabel>
          <Input id="smtp-host" value={values.host} placeholder="smtp.example.com" onChange={(event) => set('host', event.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="smtp-port">{copy.portLabel}</FieldLabel>
            <Input id="smtp-port" type="number" value={values.port} onChange={(event) => set('port', Number(event.target.value))} />
            {hint && <FieldDescription>{hint}</FieldDescription>}
          </Field>
          <Field>
            <FieldLabel htmlFor="smtp-security">{copy.securityLabel}</FieldLabel>
            <Select
              items={[
                { value: 'starttls', label: 'STARTTLS' },
                { value: 'tls', label: copy.implicitTls },
              ]}
              value={values.secure ? 'tls' : 'starttls'}
              onValueChange={(value) => set('secure', value === 'tls')}
            >
              <SelectTrigger id="smtp-security">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="starttls">STARTTLS</SelectItem>
                <SelectItem value="tls">{copy.implicitTls}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </FieldSet>
      <FieldSet>
        <FieldLegend>{copy.credentials}</FieldLegend>
        <div className="flex flex-col gap-3 sm:flex-row [&>[data-slot=field]]:flex-1">
          <Field>
            <FieldLabel htmlFor="smtp-user">{copy.userLabel}</FieldLabel>
            <Input id="smtp-user" value={values.user} autoComplete="off" onChange={(event) => set('user', event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="smtp-password">{copy.passwordLabel}</FieldLabel>
            <Input
              id="smtp-password"
              type="password"
              value={values.password}
              autoComplete="off"
              onChange={(event) => set('password', event.target.value)}
              placeholder={smtp.passwordConfigured ? copy.passwordKeep : ''}
            />
          </Field>
        </div>
      </FieldSet>
      <DialogProblem title={copy.notSaved} hint={copy.notSavedHint} error={saveMutation.error?.message ?? removeMutation.error?.message} />
      <div className="flex justify-between gap-2">
        {smtp.configured ? (
          <Button
            variant="destructive"
            disabled={smtp.source === 'environment' || removeMutation.isPending}
            onClick={() => removeMutation.mutate()}
          >
            {copy.remove}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="outline" onClick={onDone}>
            {t.common.cancel}
          </Button>
          <Button
            disabled={!values.from || !values.host || saveMutation.isPending || smtp.source === 'environment'}
            onClick={() => saveMutation.mutate({ ...values, user: values.user || undefined, password: values.password || undefined })}
          >
            {saveMutation.isPending && <Spinner />}
            {saveMutation.isPending ? copy.verifying : copy.save}
          </Button>
        </div>
      </div>
    </DialogShell>
  )
}
