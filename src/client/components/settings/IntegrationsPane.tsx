import { useState, type ReactNode } from 'react'
import { CircleAlert, ExternalLink } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import type { CloudStorageProvider, PublicIntegrationConfig, SocialAuthProvider } from '../../../core/auth'
import { CLOUD_STORAGE_PROVIDERS } from '../../../core/auth'
import { CLOUD_PROVIDER_HELP, cloudProviderLabel } from '../../storageProviders'
import { CloudProviderIcon } from '../CloudProviderIcon'
import {
  removeCloudStorageApp,
  removeSmtpSettings,
  saveCloudStorageApp,
  saveSmtpSettings,
  saveSocialProvider,
  updatePasswordAuth,
  updateSocialProviderEnabled,
} from '../../../server/fns'
import { authClient } from '../../authClient'
import { integrationsQuery } from '../../queries'
import { CopyableValue } from '../CopyableValue'
import { QueryState } from '../QueryState'
import { DialogShell } from '../DialogShell'
import { AuthMethodIcon } from '../AuthMethodIcon'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'

const PROVIDERS: { id: SocialAuthProvider; name: string; description: string }[] = [
  { id: 'google', name: 'Google', description: 'Sign in with a Google account.' },
  { id: 'discord', name: 'Discord', description: 'Sign in with a Discord account.' },
]

export function IntegrationsPane() {
  const query = useQuery(integrationsQuery())
  const data = query.data
  const [provider, setProvider] = useState<SocialAuthProvider | null>(null)
  const [cloudProvider, setCloudProvider] = useState<CloudStorageProvider | null>(null)
  const [smtpOpen, setSmtpOpen] = useState(false)
  if (!data) {
    return (
      <SettingsPage>
        <SettingsHeader title="Integrations" description="Deployment-wide sign-in methods, cloud storage apps, and outbound email." />
        <QueryState
          loading={query.isPending}
          error={query.error}
          loadingLabel="Loading integration settings…"
          errorTitle="Could not load integration settings"
          onRetry={() => void query.refetch()}
        />
      </SettingsPage>
    )
  }
  return (
    <SettingsPage>
      <SettingsHeader
        title="Integrations"
        description="Deployment-wide sign-in methods, cloud storage apps, and outbound email. Workspace membership is always invite-only."
      />
      <AuthenticationSettings data={data} onConfigure={setProvider} />
      <CloudStorageSettings data={data} onConfigure={setCloudProvider} />
      <SmtpSettings data={data} onConfigure={() => setSmtpOpen(true)} />
      {provider && <ProviderDialog provider={provider} current={data.providers[provider]} onDone={() => setProvider(null)} />}
      {cloudProvider && (
        <CloudStorageDialog provider={cloudProvider} current={data.cloudStorage[cloudProvider]} onDone={() => setCloudProvider(null)} />
      )}
      {smtpOpen && <SmtpDialog current={data} onDone={() => setSmtpOpen(false)} />}
    </SettingsPage>
  )
}

function DialogProblem({ title, hint, error }: { title: string; hint: string; error?: string }) {
  if (!error) return null
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex flex-col gap-1">
        <span>{hint}</span>
        <span className="text-xs break-words opacity-80">{error}</span>
      </AlertDescription>
    </Alert>
  )
}

function IntegrationRow({
  icon,
  name,
  status,
  detail,
  actions,
  problem,
}: {
  icon: ReactNode
  name: string
  status: { label: string; tone: 'on' | 'ready' | 'off' }
  detail: string
  actions: ReactNode
  problem?: string
}) {
  return (
    <section aria-label={name} className="rounded-lg border bg-card p-3">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted [&>svg]:size-5">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{name}</span>
            <Badge variant={status.tone === 'on' ? 'default' : status.tone === 'ready' ? 'outline' : 'secondary'}>{status.label}</Badge>
          </div>
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{detail}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 max-sm:hidden">{actions}</div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 sm:hidden">{actions}</div>
      {problem && (
        <Alert variant="destructive" className="mt-3">
          <CircleAlert />
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      )}
    </section>
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
    },
  })
  return (
    <SettingsSection
      title="Sign-in methods"
      description="Password, Google, and Discord can be enabled together. Joining an existing workspace always requires an invite."
    >
      <div className="flex flex-col gap-2">
        <IntegrationRow
          icon={<AuthMethodIcon method="password" />}
          name="Password"
          status={{ label: data.passwordEnabled ? 'Enabled' : 'Disabled', tone: data.passwordEnabled ? 'on' : 'off' }}
          detail={
            data.passwordForcedByRecovery
              ? 'Built-in email and password sign-in. Recovery mode is forcing this on.'
              : 'Built-in email and password sign-in.'
          }
          problem={passwordMutation.error?.message}
          actions={
            <Switch
              aria-label="Enable password authentication"
              checked={data.passwordEnabled}
              disabled={data.passwordSource === 'environment' || passwordMutation.isPending}
              onCheckedChange={(enabled) => passwordMutation.mutate({ data: { enabled } })}
            />
          }
        />
        {PROVIDERS.map((item) => (
          <ProviderRow key={item.id} item={item} config={data.providers[item.id]} onConfigure={() => onConfigure(item.id)} />
        ))}
      </div>
    </SettingsSection>
  )
}

function CloudStorageSettings({
  data,
  onConfigure,
}: {
  data: PublicIntegrationConfig
  onConfigure: (provider: CloudStorageProvider) => void
}) {
  return (
    <SettingsSection
      title="Cloud storage"
      description="Register one app per provider so every workspace can connect its own account. Each workspace owner signs in themselves, and their models stay in their own account."
    >
      <div className="flex flex-col gap-2">
        {CLOUD_STORAGE_PROVIDERS.map((provider) => {
          const config = data.cloudStorage[provider]
          return (
            <IntegrationRow
              key={provider}
              icon={<CloudProviderIcon provider={provider} />}
              name={cloudProviderLabel(provider)}
              status={{
                label: config.configured ? 'Available to workspaces' : 'Not set up',
                tone: config.configured ? 'ready' : 'off',
              }}
              detail={CLOUD_PROVIDER_HELP[provider].intro}
              actions={
                <Button type="button" variant="outline" size="sm" onClick={() => onConfigure(provider)}>
                  {config.configured ? 'Edit app' : 'Set up app'}
                </Button>
              }
            />
          )
        })}
      </div>
    </SettingsSection>
  )
}

function CloudStorageDialog({
  provider,
  current,
  onDone,
}: {
  provider: CloudStorageProvider
  current: PublicIntegrationConfig['cloudStorage'][CloudStorageProvider]
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [clientId, setClientId] = useState(current.clientId)
  const [clientSecret, setClientSecret] = useState('')
  const mutation = useMutation({
    mutationFn: useServerFn(saveCloudStorageApp),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['integrations'] })
      onDone()
    },
  })
  const removeMutation = useMutation({
    mutationFn: useServerFn(removeCloudStorageApp),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['integrations'] })
      onDone()
    },
  })
  const help = CLOUD_PROVIDER_HELP[provider]
  return (
    <DialogShell open title={`Set up ${cloudProviderLabel(provider)}`} className="sm:max-w-[640px]" onClose={onDone}>
      <div className="space-y-5 pr-1">
        <section className="space-y-3 text-sm text-muted-foreground">
          <a
            className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-3"
            href={help.consoleUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open {cloudProviderLabel(provider)} developer console
            <ExternalLink className="size-3.5" />
          </a>
          <ol className="list-decimal space-y-1 pl-5">
            <li>{help.credentials}</li>
            <li>{help.permissions}</li>
            <li>Copy the credentials below. Workspace owners then connect their own accounts from Settings → Storage.</li>
          </ol>
          <CopyableValue label="OAuth redirect URI" value={current.callbackUrl} />
        </section>
        <FieldSet>
          <FieldLegend>App credentials</FieldLegend>
          <div className="flex flex-col gap-3 sm:flex-row [&>[data-slot=field]]:flex-1">
            <Field>
              <FieldLabel htmlFor="cloud-client-id">{provider === 'dropbox' ? 'App key' : 'Client ID'}</FieldLabel>
              <Input id="cloud-client-id" value={clientId} autoComplete="off" onChange={(event) => setClientId(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="cloud-client-secret">{help.secret}</FieldLabel>
              <Input
                id="cloud-client-secret"
                type="password"
                value={clientSecret}
                autoComplete="off"
                onChange={(event) => setClientSecret(event.target.value)}
                placeholder={current.secretConfigured ? 'Leave blank to keep the current secret' : ''}
              />
            </Field>
          </div>
        </FieldSet>
        <DialogProblem
          title={`${cloudProviderLabel(provider)} was not saved`}
          hint={`Check that the credentials match the app in the ${cloudProviderLabel(provider)} console.`}
          error={mutation.error?.message ?? removeMutation.error?.message}
        />
        <div className="flex flex-wrap justify-between gap-2">
          {current.configured ? (
            <Button variant="destructive" disabled={removeMutation.isPending} onClick={() => removeMutation.mutate({ data: { provider } })}>
              {removeMutation.isPending && <Spinner />}
              Remove app
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onDone}>
              Cancel
            </Button>
            <Button
              disabled={!clientId || (!current.secretConfigured && !clientSecret) || mutation.isPending}
              onClick={() => mutation.mutate({ data: { provider, clientId, clientSecret } })}
            >
              {mutation.isPending && <Spinner />}
              {mutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </DialogShell>
  )
}

function ProviderRow({
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
    },
  })
  const status = config.enabled
    ? { label: 'Enabled', tone: 'on' as const }
    : config.linked
      ? { label: 'Tested, not enabled', tone: 'ready' as const }
      : config.configured
        ? { label: 'Needs testing', tone: 'ready' as const }
        : { label: 'Not set up', tone: 'off' as const }
  return (
    <IntegrationRow
      icon={<AuthMethodIcon method={item.id} />}
      name={item.name}
      status={status}
      detail={
        config.configured && !config.linked
          ? `${item.description} Sign in once with ${item.name} to prove the credentials work, then enable it.`
          : item.description
      }
      problem={mutation.error?.message}
      actions={
        <>
          <Button type="button" variant="outline" size="sm" onClick={onConfigure}>
            {config.configured ? 'Edit app' : 'Set up app'}
          </Button>
          {config.configured && !config.linked && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                void authClient.linkSocial({
                  provider: item.id,
                  callbackURL: '/admin/integrations',
                  errorCallbackURL: '/admin/integrations',
                })
              }
            >
              Test sign-in
            </Button>
          )}
          <Switch
            aria-label={`Enable ${item.name} authentication`}
            checked={config.enabled}
            disabled={!config.configured || !config.linked || config.source === 'environment' || mutation.isPending}
            onCheckedChange={(enabled) => mutation.mutate({ data: { provider: item.id, enabled } })}
          />
        </>
      }
    />
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
        <FieldSet>
          <FieldLegend>App credentials</FieldLegend>
          <div className="flex flex-col gap-3 sm:flex-row [&>[data-slot=field]]:flex-1">
            <Field>
              <FieldLabel htmlFor="provider-client-id">Client ID</FieldLabel>
              <Input id="provider-client-id" value={clientId} autoComplete="off" onChange={(event) => setClientId(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="provider-client-secret">Client secret</FieldLabel>
              <Input
                id="provider-client-secret"
                type="password"
                value={clientSecret}
                autoComplete="off"
                onChange={(event) => setClientSecret(event.target.value)}
                placeholder={current.secretConfigured ? 'Leave blank to keep the current secret' : ''}
              />
            </Field>
          </div>
          <FieldDescription>After saving, sign in once with {name} to prove the credentials work. Then enable it.</FieldDescription>
        </FieldSet>
        <DialogProblem
          title={`${name} credentials were not saved`}
          hint={`Check that the client ID and secret match the OAuth client in ${providerConsoleName(provider)}.`}
          error={mutation.error?.message}
        />
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

function providerConsoleName(provider: SocialAuthProvider) {
  return provider === 'google' ? 'Google Auth Platform' : 'Discord Developer Portal'
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
  const providerUrl = isGoogle ? 'https://console.cloud.google.com/auth/clients' : 'https://discord.com/developers/applications'

  return (
    <section aria-label={`${isGoogle ? 'Google' : 'Discord'} setup instructions`} className="space-y-3 text-sm text-muted-foreground">
      <a
        className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-3"
        href={providerUrl}
        target="_blank"
        rel="noreferrer"
      >
        Open {providerConsoleName(provider)}
        <ExternalLink className="size-3.5" />
      </a>
      <ol className="list-decimal space-y-1 pl-5">
        {isGoogle ? (
          <>
            <li>Select or create a Google Cloud project, then configure its Branding and Audience screens.</li>
            <li>Open Clients and create an OAuth client with the application type Web application.</li>
            <li>Add the STL Quest URL below to Authorized JavaScript origins.</li>
            <li>Add the callback URL below to Authorized redirect URIs exactly as shown.</li>
            <li>Copy the generated client ID and client secret into STL Quest.</li>
          </>
        ) : (
          <>
            <li>Create or select a Discord application, then open its OAuth2 settings.</li>
            <li>Add the callback URL below under Redirects and save the change.</li>
            <li>Copy the client ID, then reset and copy the client secret into STL Quest.</li>
          </>
        )}
      </ol>
      {isGoogle && <CopyableValue label="STL Quest URL" value={origin} />}
      <CopyableValue label="Callback URL" value={callbackUrl} />
    </section>
  )
}

function SmtpSettings({ data, onConfigure }: { data: PublicIntegrationConfig; onConfigure: () => void }) {
  return (
    <SettingsSection title="Outbound email" description="Optional. SMTP delivers workspace invitations and self-service password resets.">
      <IntegrationRow
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
