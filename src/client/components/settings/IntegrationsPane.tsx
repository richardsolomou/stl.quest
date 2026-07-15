import { useState, type ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import type { PublicIntegrationConfig, SocialAuthProvider } from '../../../core/auth'
import {
  removeSmtpSettings,
  saveSmtpSettings,
  saveSocialProvider,
  updatePasswordAuth,
  updateSocialProviderEnabled,
} from '../../../server/fns'
import { authClient } from '../../authClient'
import { integrationsQuery } from '../../queries'
import { DialogShell } from '../DialogShell'
import { AuthMethodIcon } from '../AuthMethodIcon'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'

const PROVIDERS: { id: SocialAuthProvider; name: string; description: string; icon: ReactNode }[] = [
  { id: 'google', name: 'Google', description: 'Sign in with a Google account.', icon: <MethodBadge method="google" /> },
  { id: 'discord', name: 'Discord', description: 'Sign in with a Discord account.', icon: <MethodBadge method="discord" /> },
]

export function IntegrationsPane() {
  const { data } = useQuery(integrationsQuery())
  const [provider, setProvider] = useState<SocialAuthProvider | null>(null)
  const [smtpOpen, setSmtpOpen] = useState(false)
  if (!data) return <SettingsHeader title="Integrations" description="Loading integration settings…" />
  return (
    <SettingsPage>
      <SettingsHeader
        title="Integrations"
        description="Configure sign-in methods and optional SMTP delivery. New accounts are always invite-only."
      />
      <AuthenticationSettings data={data} onConfigure={setProvider} />
      <SmtpSettings data={data} onConfigure={() => setSmtpOpen(true)} />
      {provider && <ProviderDialog provider={provider} current={data.providers[provider]} onDone={() => setProvider(null)} />}
      {smtpOpen && <SmtpDialog current={data} onDone={() => setSmtpOpen(false)} />}
    </SettingsPage>
  )
}

function AuthenticationSettings({
  data,
  onConfigure,
}: {
  data: PublicIntegrationConfig
  onConfigure: (provider: SocialAuthProvider) => void
}) {
  const queryClient = useQueryClient()
  const passwordMutation = useMutation({
    mutationFn: useServerFn(updatePasswordAuth),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['integrations'] }),
        queryClient.invalidateQueries({ queryKey: ['session'] }),
      ])
      toast.success('Password authentication updated.')
    },
  })
  return (
    <SettingsSection
      title="Authentication"
      description="Password, Google, and Discord can be enabled together. Account creation always requires an invite."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MethodBadge method="password" /> Password
            </CardTitle>
            <CardDescription>Built-in email and password authentication.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            <Badge variant={data.passwordEnabled ? 'default' : 'secondary'}>{data.passwordEnabled ? 'Enabled' : 'Disabled'}</Badge>
            <Switch
              aria-label="Enable password authentication"
              checked={data.passwordEnabled}
              disabled={data.passwordSource === 'environment' || passwordMutation.isPending}
              onCheckedChange={(enabled) => passwordMutation.mutate({ data: { enabled } })}
            />
          </CardContent>
        </Card>
        {PROVIDERS.map((item) => (
          <ProviderCard key={item.id} item={item} config={data.providers[item.id]} onConfigure={() => onConfigure(item.id)} />
        ))}
      </div>
      {data.passwordForcedByRecovery && <p className="text-sm text-muted-foreground">Recovery mode is forcing passwords on.</p>}
      <FieldError>{passwordMutation.error?.message}</FieldError>
    </SettingsSection>
  )
}

function ProviderCard({
  item,
  config,
  onConfigure,
}: {
  item: (typeof PROVIDERS)[number]
  config: PublicIntegrationConfig['providers'][SocialAuthProvider]
  onConfigure: () => void
}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: useServerFn(updateSocialProviderEnabled),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['integrations'] }),
        queryClient.invalidateQueries({ queryKey: ['session'] }),
      ])
      toast.success(`${item.name} authentication updated.`)
    },
  })
  return (
    <section aria-label={`${item.name} authentication`}>
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {item.icon}
            {item.name}
          </CardTitle>
          <CardDescription>{item.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <Badge variant={config.enabled ? 'default' : 'secondary'}>
              {config.enabled ? 'Enabled' : config.linked ? 'Tested' : config.configured ? 'Configured' : 'Not configured'}
            </Badge>
            <Switch
              aria-label={`Enable ${item.name} authentication`}
              checked={config.enabled}
              disabled={!config.configured || !config.linked || config.source === 'environment' || mutation.isPending}
              onCheckedChange={(enabled) => mutation.mutate({ data: { provider: item.id, enabled } })}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onConfigure}>
              {config.configured ? 'Edit' : 'Configure'}
            </Button>
            {config.configured && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  void authClient.linkSocial({
                    provider: item.id,
                    callbackURL: '/settings/integrations',
                    errorCallbackURL: '/settings/integrations',
                  })
                }
              >
                Test and link
              </Button>
            )}
          </div>
          <FieldError>{mutation.error?.message}</FieldError>
        </CardContent>
      </Card>
    </section>
  )
}

function ProviderDialog({
  provider,
  current,
  onDone,
}: {
  provider: SocialAuthProvider
  current: PublicIntegrationConfig['providers'][SocialAuthProvider]
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [clientId, setClientId] = useState(current.clientId)
  const [clientSecret, setClientSecret] = useState('')
  const mutation = useMutation({
    mutationFn: useServerFn(saveSocialProvider),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['integrations'] })
      toast.success('Provider credentials saved.')
      onDone()
    },
  })
  const name = PROVIDERS.find((item) => item.id === provider)?.name ?? provider
  const origin = window.location.origin
  const callbackUrl = `${origin}/api/auth/callback/${provider}`
  return (
    <DialogShell open title={`Configure ${name}`} className="sm:max-w-[640px]" onClose={onDone}>
      <div className="space-y-5 pr-1">
        <ProviderSetupInstructions provider={provider} origin={origin} callbackUrl={callbackUrl} />
        <Field>
          <FieldLabel htmlFor="provider-client-id">Client ID</FieldLabel>
          <Input id="provider-client-id" value={clientId} onChange={(event) => setClientId(event.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="provider-client-secret">Client secret</FieldLabel>
          <Input
            id="provider-client-secret"
            type="password"
            value={clientSecret}
            onChange={(event) => setClientSecret(event.target.value)}
            placeholder={current.secretConfigured ? 'Leave blank to keep the current secret' : ''}
          />
        </Field>
        <FieldDescription>Save, close this dialog, then select Test and link. Once that succeeds, enable the provider.</FieldDescription>
        <FieldError>{mutation.error?.message}</FieldError>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button
            disabled={!clientId || mutation.isPending}
            onClick={() => mutation.mutate({ data: { provider, clientId, clientSecret } })}
          >
            {mutation.isPending && <Spinner />}
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </DialogShell>
  )
}

function ProviderSetupInstructions({
  provider,
  origin,
  callbackUrl,
}: {
  provider: SocialAuthProvider
  origin: string
  callbackUrl: string
}) {
  const isGoogle = provider === 'google'
  const providerName = isGoogle ? 'Google Auth Platform' : 'Discord Developer Portal'
  const providerUrl = isGoogle ? 'https://console.cloud.google.com/auth/clients' : 'https://discord.com/developers/applications'

  return (
    <section aria-label={`${isGoogle ? 'Google' : 'Discord'} setup instructions`} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-heading font-medium">Set up the provider</h3>
        <a
          className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
          href={providerUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open {providerName}
          <ExternalLink className="size-3.5" />
        </a>
      </div>
      <ol className="ml-5 list-decimal space-y-2 text-sm text-muted-foreground">
        {isGoogle ? (
          <>
            <li>Select or create a Google Cloud project, then configure its Branding and Audience screens.</li>
            <li>Open Clients and create an OAuth client with the application type Web application.</li>
            <li>Add the PrintHub URL below to Authorized JavaScript origins.</li>
            <li>Add the callback URL below to Authorized redirect URIs exactly as shown.</li>
            <li>Copy the generated client ID and client secret into PrintHub.</li>
          </>
        ) : (
          <>
            <li>Create or select a Discord application, then open its OAuth2 settings.</li>
            <li>Add the callback URL below under Redirects and save the change.</li>
            <li>Copy the client ID, then reset and copy the client secret into PrintHub.</li>
          </>
        )}
      </ol>
      {isGoogle && <SetupValue label="PrintHub URL" value={origin} />}
      <SetupValue label="Callback URL" value={callbackUrl} />
    </section>
  )
}

function SetupValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2">
        <code className="min-w-0 flex-1 break-all text-xs">{value}</code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Copy ${label}`}
          onClick={() => void navigator.clipboard.writeText(value).then(() => toast.success(`${label} copied.`))}
        >
          Copy
        </Button>
      </div>
    </div>
  )
}

function SmtpSettings({ data, onConfigure }: { data: PublicIntegrationConfig; onConfigure: () => void }) {
  return (
    <SettingsSection title="Outbound email" description="SMTP is optional and enables invite delivery and self-service password resets.">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MethodBadge method="smtp" /> SMTP
          </CardTitle>
          <CardDescription>Connect any standard mail server or self-hosted relay.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Badge variant={data.smtp.configured ? 'default' : 'secondary'}>{data.smtp.configured ? 'Configured' : 'Not configured'}</Badge>
          {data.smtp.configured && <p className="min-w-40 flex-1 truncate text-sm text-muted-foreground">{data.smtp.from}</p>}
          <Button type="button" variant="outline" size="sm" onClick={onConfigure}>
            {data.smtp.configured ? 'Edit' : 'Configure'}
          </Button>
        </CardContent>
      </Card>
    </SettingsSection>
  )
}

function SmtpDialog({ current, onDone }: { current: PublicIntegrationConfig; onDone: () => void }) {
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['integrations'] }),
        queryClient.invalidateQueries({ queryKey: ['session'] }),
      ])
      toast.success('SMTP verified and saved.')
      onDone()
    },
  })
  const removeMutation = useMutation({
    mutationFn: useServerFn(removeSmtpSettings),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['integrations'] }),
        queryClient.invalidateQueries({ queryKey: ['session'] }),
      ])
      toast.success('SMTP removed.')
      onDone()
    },
  })
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => setValues((state) => ({ ...state, [key]: value }))
  return (
    <DialogShell open title={smtp.configured ? 'Edit SMTP' : 'Configure SMTP'} onClose={onDone}>
      <p className="text-sm text-muted-foreground">Credentials are verified and a test message is sent before saving.</p>
      <Field>
        <FieldLabel htmlFor="smtp-from">From</FieldLabel>
        <Input id="smtp-from" value={values.from} onChange={(event) => set('from', event.target.value)} />
      </Field>
      <Field>
        <FieldLabel htmlFor="smtp-host">Host</FieldLabel>
        <Input id="smtp-host" value={values.host} onChange={(event) => set('host', event.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor="smtp-port">Port</FieldLabel>
          <Input id="smtp-port" type="number" value={values.port} onChange={(event) => set('port', Number(event.target.value))} />
        </Field>
        <Field>
          <FieldLabel htmlFor="smtp-security">Security</FieldLabel>
          <Select value={values.secure ? 'tls' : 'starttls'} onValueChange={(value) => set('secure', value === 'tls')}>
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
      <Field>
        <FieldLabel htmlFor="smtp-user">Username</FieldLabel>
        <Input id="smtp-user" value={values.user} onChange={(event) => set('user', event.target.value)} />
      </Field>
      <Field>
        <FieldLabel htmlFor="smtp-password">Password</FieldLabel>
        <Input
          id="smtp-password"
          type="password"
          value={values.password}
          onChange={(event) => set('password', event.target.value)}
          placeholder={smtp.passwordConfigured ? 'Leave blank to keep current password' : ''}
        />
      </Field>
      <FieldError>{saveMutation.error?.message ?? removeMutation.error?.message}</FieldError>
      <div className="flex justify-between gap-2">
        {smtp.configured ? (
          <Button
            variant="destructive"
            disabled={smtp.source === 'environment' || removeMutation.isPending}
            onClick={() => removeMutation.mutate({})}
          >
            Remove
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

function MethodBadge({ method }: { method: 'password' | 'smtp' | SocialAuthProvider }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
      <AuthMethodIcon method={method} />
    </span>
  )
}
