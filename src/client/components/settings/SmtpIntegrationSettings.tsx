import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import type { PublicIntegrationConfig } from '../../../core/auth'
import { removeSmtpSettings, saveSmtpSettings } from '../../../server/fns'
import { invalidateQueries } from '../../queryState'
import { AuthMethodIcon } from '../AuthMethodIcon'
import { DialogProblem } from '../DialogProblem'
import { DialogShell } from '../DialogShell'
import { SettingRow } from '../SettingRow'
import { SettingsSection } from './SettingsLayout'

export function SmtpSettings({ data, onConfigure }: { data: PublicIntegrationConfig; onConfigure: () => void }) {
  return (
    <SettingsSection title="Outbound email" description="Optional. SMTP delivers workspace invitations and self-service password resets.">
      <SettingRow
        icon={<AuthMethodIcon method="smtp" />}
        name="SMTP"
        status={{ label: data.smtp.configured ? 'Sending' : 'Not set up', tone: data.smtp.configured ? 'on' : 'off' }}
        detail={
          data.smtp.configured ? `Messages are sent from ${data.smtp.from}.` : 'Connect any standard mail server or self-hosted relay.'
        }
        actions={
          <Button type="button" variant="outline" size="sm" onClick={onConfigure}>
            {data.smtp.configured ? 'Edit' : 'Set up SMTP'}
          </Button>
        }
      />
    </SettingsSection>
  )
}

export function SmtpDialog({ current, onDone }: { current: PublicIntegrationConfig; onDone: () => void }) {
  const queryClient = useQueryClient()
  const smtp = current.smtp
  const [values, setValues] = useState({
    from: smtp.from,
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    user: smtp.user ?? '',
    password: '',
  })
  const saveMutation = useMutation({
    mutationFn: useServerFn(saveSmtpSettings),
    onSuccess: async () => {
      await invalidateQueries(queryClient, 'integrations', 'session')
      onDone()
    },
  })
  const removeMutation = useMutation({
    mutationFn: useServerFn(removeSmtpSettings),
    onSuccess: async () => {
      await invalidateQueries(queryClient, 'integrations', 'session')
      onDone()
    },
  })
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => setValues((state) => ({ ...state, [key]: value }))
  return (
    <DialogShell open title={smtp.configured ? 'Edit SMTP' : 'Configure SMTP'} onClose={onDone}>
      <p className="text-sm leading-relaxed text-muted-foreground">
        STL Quest signs in and sends a test message before saving, so mistakes surface here rather than on the first invitation.
      </p>
      <FieldSet>
        <FieldLegend>Server</FieldLegend>
        <Field>
          <FieldLabel htmlFor="smtp-from">From address</FieldLabel>
          <Input
            id="smtp-from"
            value={values.from}
            placeholder="prints@example.com"
            onChange={(event) => set('from', event.target.value)}
          />
          <FieldDescription>Recipients see this address on invitations and password resets.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="smtp-host">Host</FieldLabel>
          <Input id="smtp-host" value={values.host} placeholder="smtp.example.com" onChange={(event) => set('host', event.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="smtp-port">Port</FieldLabel>
            <Input id="smtp-port" type="number" value={values.port} onChange={(event) => set('port', Number(event.target.value))} />
          </Field>
          <Field>
            <FieldLabel htmlFor="smtp-security">Security</FieldLabel>
            <Select
              items={[
                { value: 'starttls', label: 'STARTTLS' },
                { value: 'tls', label: 'Implicit TLS' },
              ]}
              value={values.secure ? 'tls' : 'starttls'}
              onValueChange={(value) => set('secure', value === 'tls')}
            >
              <SelectTrigger id="smtp-security">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="starttls">STARTTLS</SelectItem>
                <SelectItem value="tls">Implicit TLS</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </FieldSet>
      <FieldSet>
        <FieldLegend>Credentials</FieldLegend>
        <div className="flex flex-col gap-3 sm:flex-row [&>[data-slot=field]]:flex-1">
          <Field>
            <FieldLabel htmlFor="smtp-user">Username</FieldLabel>
            <Input id="smtp-user" value={values.user} autoComplete="off" onChange={(event) => set('user', event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="smtp-password">Password</FieldLabel>
            <Input
              id="smtp-password"
              type="password"
              value={values.password}
              autoComplete="off"
              onChange={(event) => set('password', event.target.value)}
              placeholder={smtp.passwordConfigured ? 'Leave blank to keep current password' : ''}
            />
          </Field>
        </div>
      </FieldSet>
      <DialogProblem
        title="SMTP was not saved"
        hint="Check the host, port, and security mode, and that this server can reach the mail host."
        error={saveMutation.error?.message ?? removeMutation.error?.message}
      />
      <div className="flex justify-between gap-2">
        {smtp.configured ? (
          <Button
            variant="destructive"
            disabled={smtp.source === 'environment' || removeMutation.isPending}
            onClick={() => removeMutation.mutate({})}
          >
            Remove SMTP
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button
            disabled={!values.from || !values.host || saveMutation.isPending || smtp.source === 'environment'}
            onClick={() =>
              saveMutation.mutate({ data: { ...values, user: values.user || undefined, password: values.password || undefined } })
            }
          >
            {saveMutation.isPending && <Spinner />}
            {saveMutation.isPending ? 'Verifying…' : 'Verify and save'}
          </Button>
        </div>
      </div>
    </DialogShell>
  )
}
