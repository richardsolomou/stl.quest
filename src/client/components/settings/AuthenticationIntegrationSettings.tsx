import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { useLocation } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { OIDC_DEFAULT_SCOPES, OIDC_NAME_MAX_LENGTH, type PublicIntegrationConfig, type SocialAuthProvider } from '../../../core/auth'
import { saveSocialProvider, updatePasswordAuth, updateSocialProviderEnabled } from '../../../server/fns'
import {
  socialProviderTestErrorCode,
  socialProviderTestFailure,
  socialProviderTestResult,
  startSocialProviderTest,
} from '../../socialProviderTest'
import { invalidateQueries } from '../../queryState'
import { SOCIAL_PROVIDER_OPTIONS, SOCIAL_PROVIDER_SETTINGS } from '../../socialProviderSettings'
import { AuthMethodIcon } from '../AuthMethodIcon'
import { DialogProblem } from '../DialogProblem'
import { DialogShell } from '../DialogShell'
import { SettingRow } from '../SettingRow'
import { SettingsSection } from './SettingsLayout'
import { SocialProviderSetupInstructions } from './SocialProviderSetupInstructions'
import { useI18n } from '../../i18n'

const refreshIntegrationSettings = (queryClient: ReturnType<typeof useQueryClient>) =>
  invalidateQueries(queryClient, 'integrations', 'session', 'auth-capabilities')

export function AuthenticationSettings({
  data,
  onConfigure,
}: {
  data: PublicIntegrationConfig
  onConfigure: (provider: SocialAuthProvider) => void
}) {
  const queryClient = useQueryClient()
  const passwordMutation = useMutation({
    mutationFn: useServerFn(updatePasswordAuth),
    onSuccess: () => refreshIntegrationSettings(queryClient),
  })
  const { t } = useI18n()
  const copy = t.settings.signIn
  return (
    <SettingsSection title={copy.title} description={copy.description}>
      <div className="flex flex-col gap-2">
        <SettingRow
          icon={<AuthMethodIcon method="password" />}
          name={copy.password.name}
          status={{ label: data.passwordEnabled ? copy.status.enabled : copy.status.disabled, tone: data.passwordEnabled ? 'on' : 'off' }}
          detail={data.passwordForcedByRecovery ? copy.password.detailRecovery : copy.password.detail}
          problem={passwordMutation.error?.message}
          actions={
            <Switch
              aria-label={copy.password.toggle}
              checked={data.passwordEnabled}
              disabled={data.passwordSource === 'environment' || passwordMutation.isPending}
              onCheckedChange={(enabled) => passwordMutation.mutate({ data: { enabled } })}
            />
          }
        />
        {SOCIAL_PROVIDER_OPTIONS.map((item) => (
          <ProviderRow key={item.id} item={item} config={data.providers[item.id]} onConfigure={() => onConfigure(item.id)} />
        ))}
      </div>
    </SettingsSection>
  )
}

function ProviderRow({
  item,
  config,
  onConfigure,
}: {
  item: (typeof SOCIAL_PROVIDER_OPTIONS)[number]
  config: PublicIntegrationConfig['providers'][SocialAuthProvider]
  onConfigure: () => void
}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: useServerFn(updateSocialProviderEnabled),
    onSuccess: () => refreshIntegrationSettings(queryClient),
  })
  const { t } = useI18n()
  const copy = t.settings.signIn
  const search = useLocation({ select: (location) => location.searchStr })
  const result = socialProviderTestResult(search, item.id)
  const testMutation = useMutation({
    mutationFn: () => startSocialProviderTest(item.id, copy.provider.testFailed),
  })
  const callbackFailure =
    socialProviderTestFailure(search, item.id, copy.provider) ??
    (result === 'returned' && !config.linked ? copy.provider.testErrors.linking : undefined)
  const failure = mutation.error?.message ?? testMutation.error?.message ?? callbackFailure
  const errorCode = socialProviderTestErrorCode(search, item.id)
  const description = t.settings.socialProviders[item.id].description
  const status = config.enabled
    ? { label: copy.status.enabled, tone: 'on' as const }
    : config.linked
      ? { label: copy.status.tested, tone: 'ready' as const }
      : config.configured
        ? { label: copy.status.needsTesting, tone: 'ready' as const }
        : { label: copy.status.notSetUp, tone: 'off' as const }
  return (
    <SettingRow
      icon={<AuthMethodIcon method={item.id} />}
      name={item.name}
      status={status}
      detail={config.configured && !config.linked ? `${description} ${copy.provider.testHint(item.name)}` : description}
      success={result === 'returned' && config.linked ? copy.provider.testSucceeded : undefined}
      problem={
        failure ? (
          <div className="min-w-0 space-y-2">
            <p>{failure}</p>
            {errorCode && !mutation.error && !testMutation.error && (
              <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs">
                <code>{errorCode}</code>
              </pre>
            )}
          </div>
        ) : undefined
      }
      actions={
        <>
          <Button type="button" variant="outline" size="sm" onClick={onConfigure}>
            {config.configured ? copy.provider.editApp : copy.provider.setUpApp}
          </Button>
          {config.configured && !config.linked && (
            <Button type="button" variant="outline" size="sm" disabled={testMutation.isPending} onClick={() => testMutation.mutate()}>
              {testMutation.isPending && <Spinner />}
              {testMutation.isPending ? copy.provider.testing : copy.provider.test}
            </Button>
          )}
          <Switch
            aria-label={copy.provider.toggle(item.name)}
            checked={config.enabled}
            disabled={!config.configured || !config.linked || config.source === 'environment' || mutation.isPending}
            onCheckedChange={(enabled) => mutation.mutate({ data: { provider: item.id, enabled } })}
          />
        </>
      }
    />
  )
}

export function ProviderDialog({
  provider,
  current,
  origin,
  onDone,
}: {
  provider: SocialAuthProvider
  current: PublicIntegrationConfig['providers'][SocialAuthProvider]
  origin: string
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [clientId, setClientId] = useState(current.clientId)
  const [clientSecret, setClientSecret] = useState('')
  const [issuer, setIssuer] = useState(current.issuer ?? '')
  const [scopes, setScopes] = useState((current.scopes ?? OIDC_DEFAULT_SCOPES).join(' '))
  const [buttonName, setButtonName] = useState(current.name ?? '')
  const [allowSignup, setAllowSignup] = useState(current.allowSignup ?? true)
  const mutation = useMutation({
    mutationFn: useServerFn(saveSocialProvider),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['integrations'] })
      onDone()
    },
  })
  const { t } = useI18n()
  const copy = t.settings.signIn.dialog
  const name = SOCIAL_PROVIDER_SETTINGS[provider].name
  const callbackUrl = `${origin}/api/auth/callback/${provider}`
  const oidc = provider === 'oidc'
  return (
    <DialogShell open title={copy.title(name)} className="sm:max-w-[640px]" onClose={onDone}>
      <div className="space-y-5 pr-1">
        <SocialProviderSetupInstructions provider={provider} origin={origin} callbackUrl={callbackUrl} />
        <FieldSet>
          <FieldLegend>{copy.credentials}</FieldLegend>
          <div className="flex flex-col gap-3 sm:flex-row [&>[data-slot=field]]:flex-1">
            <Field>
              <FieldLabel htmlFor="provider-client-id">{copy.clientId}</FieldLabel>
              <Input id="provider-client-id" value={clientId} autoComplete="off" onChange={(event) => setClientId(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="provider-client-secret">{copy.clientSecret}</FieldLabel>
              <Input
                id="provider-client-secret"
                type="password"
                value={clientSecret}
                autoComplete="off"
                onChange={(event) => setClientSecret(event.target.value)}
                placeholder={current.secretConfigured ? copy.secretKeep : ''}
              />
            </Field>
          </div>
          {oidc && (
            <>
              <Field>
                <FieldLabel htmlFor="provider-issuer">{copy.issuer}</FieldLabel>
                <Input
                  id="provider-issuer"
                  type="url"
                  value={issuer}
                  autoComplete="off"
                  placeholder="https://auth.example.com/application/o/stlquest/"
                  onChange={(event) => setIssuer(event.target.value)}
                />
                <FieldDescription>{copy.issuerHint}</FieldDescription>
              </Field>
              <Field>
                <div className="flex items-center justify-between gap-3">
                  <FieldLabel htmlFor="provider-allow-signup">{copy.allowSignup}</FieldLabel>
                  <Switch
                    id="provider-allow-signup"
                    checked={allowSignup}
                    disabled={current.allowSignupSource === 'environment' || current.source === 'environment'}
                    onCheckedChange={setAllowSignup}
                  />
                </div>
                <FieldDescription>
                  {current.allowSignupSource === 'environment' || current.source === 'environment'
                    ? copy.allowSignupManaged
                    : copy.allowSignupHint}
                </FieldDescription>
              </Field>
              <div className="flex flex-col gap-3 sm:flex-row [&>[data-slot=field]]:flex-1">
                <Field>
                  <FieldLabel htmlFor="provider-scopes">{copy.scopes}</FieldLabel>
                  <Input id="provider-scopes" value={scopes} autoComplete="off" onChange={(event) => setScopes(event.target.value)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="provider-name">{copy.buttonLabel}</FieldLabel>
                  <Input
                    id="provider-name"
                    value={buttonName}
                    maxLength={OIDC_NAME_MAX_LENGTH}
                    autoComplete="off"
                    placeholder={copy.buttonPlaceholder}
                    onChange={(event) => setButtonName(event.target.value)}
                  />
                </Field>
              </div>
            </>
          )}
          <FieldDescription>{copy.afterSave(name)}</FieldDescription>
        </FieldSet>
        <DialogProblem
          title={copy.notSaved(name)}
          hint={copy.notSavedHint(t.settings.socialProviders[provider].consoleName)}
          error={mutation.error?.message}
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onDone}>
            {t.common.cancel}
          </Button>
          <Button
            disabled={
              !clientId ||
              (oidc && !issuer) ||
              mutation.isPending ||
              (current.configured &&
                clientId === current.clientId &&
                clientSecret === '' &&
                (!oidc ||
                  (issuer === (current.issuer ?? '') &&
                    scopes === (current.scopes ?? OIDC_DEFAULT_SCOPES).join(' ') &&
                    buttonName === (current.name ?? '') &&
                    allowSignup === (current.allowSignup ?? true))))
            }
            onClick={() =>
              mutation.mutate({
                data:
                  provider === 'oidc'
                    ? { provider, clientId, clientSecret, issuer, scopes, name: buttonName, allowSignup }
                    : { provider, clientId, clientSecret },
              })
            }
          >
            {mutation.isPending && <Spinner />}
            {mutation.isPending ? t.common.saving : t.common.save}
          </Button>
        </div>
      </div>
    </DialogShell>
  )
}
