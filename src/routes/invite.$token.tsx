import { useEffect, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordLengthError } from '../core/security'
import { acceptInvite, acceptWorkspaceInvite, beginProviderInvite, inviteInfo, switchWorkspace } from '../server/fns'
import { AuthBrand } from '../client/components/Brand'
import { AuthMethodIcon } from '../client/components/AuthMethodIcon'
import { PasswordAuthDivider } from '../client/components/PasswordAuthDivider'
import { authClient } from '../client/authClient'
import { useI18n } from '../client/i18n'
import { errorMessage } from '../core/error'
import { socialProviderName, type SocialAuthProvider } from '../core/auth'
import { authCapabilitiesQuery } from '../client/queries'
import { MAX_USER_NAME_LENGTH } from '../core/identity'

export const Route = createFileRoute('/invite/$token')({
  loader: async ({ params }) => {
    const info = await inviteInfo({ data: { token: params.token } })
    if (info.joined) throw redirect({ to: '/' })
    return info
  },
  component: InvitePage,
})

function InvitePage() {
  const { t } = useI18n()
  const copy = t.auth.invite
  const { valid, signedIn, auth: loadedAuth } = Route.useLoaderData()
  const { data: auth } = useQuery({ ...authCapabilitiesQuery(), initialData: loadedAuth })
  const { token } = Route.useParams()
  const callAccept = useServerFn(acceptInvite)
  const callAcceptWorkspace = useServerFn(acceptWorkspaceInvite)
  const callBeginProvider = useServerFn(beginProviderInvite)
  const callSwitchWorkspace = useServerFn(switchWorkspace)
  const [error, setError] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const [providerBusy, setProviderBusy] = useState<SocialAuthProvider | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  useEffect(() => setHydrated(true), [])

  const joinWorkspace = async () => {
    await callAcceptWorkspace({ data: { token } })
    window.location.href = '/'
  }

  const continueWithProvider = async (provider: SocialAuthProvider) => {
    setError('')
    setProviderBusy(provider)
    try {
      await callBeginProvider({ data: { token, provider } })
      const { error: failed } = await authClient.signIn.social({
        provider,
        callbackURL: `/invite/${token}`,
        errorCallbackURL: `/invite/${token}`,
        requestSignUp: true,
      })
      if (failed) setError(t.auth.continueFailed(socialProviderName(provider, auth.oidcName)))
    } catch (err) {
      setError(errorMessage(err, copy.providerFailed))
    } finally {
      setProviderBusy(null)
    }
  }

  const form = useForm({
    defaultValues: { name: '', email: '', password: '' },
    onSubmit: async ({ value }) => {
      setError('')
      try {
        if (signingIn) {
          const { error: failed } = await authClient.signIn.email({ email: value.email, password: value.password })
          if (failed) {
            setError(t.auth.signInFailure.invalidCredentials)
            return
          }
          await joinWorkspace()
        } else {
          const workspace = await callAccept({ data: { token, ...value } })
          await callSwitchWorkspace({ data: { workspaceId: workspace.workspaceId } })
          window.location.href = '/'
        }
      } catch (err) {
        setError(errorMessage(err, copy.acceptFailed))
      }
    },
  })

  return (
    <main className="grid min-h-dvh place-items-center p-6 [background-image:var(--grid)] [background-size:24px_24px]">
      <div className="flex w-full max-w-[440px] flex-col gap-8">
        <AuthBrand />
        {valid ? (
          <Card className="w-full shadow-xl shadow-black/10">
            <CardHeader>
              <CardTitle>{copy.title}</CardTitle>
              <CardDescription>
                {signedIn ? copy.signedInDescription : signingIn ? copy.signInDescription : copy.createDescription}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {signedIn && (
                <Button
                  type="button"
                  onClick={async () => {
                    setError('')
                    try {
                      await joinWorkspace()
                    } catch (err) {
                      setError(errorMessage(err, copy.joinFailed))
                    }
                  }}
                >
                  {copy.join}
                </Button>
              )}
              {!signedIn && auth.socialProviders.length > 0 && (
                <div className="flex flex-col gap-2">
                  {auth.socialProviders.map((provider) => (
                    <Button
                      key={provider}
                      type="button"
                      variant="outline"
                      disabled={providerBusy !== null}
                      onClick={() => void continueWithProvider(provider)}
                    >
                      {providerBusy === provider && <Spinner />}
                      {!providerBusy && <AuthMethodIcon method={provider} />}
                      {t.auth.continueWith(socialProviderName(provider, auth.oidcName))}
                    </Button>
                  ))}
                  {auth.password && <PasswordAuthDivider />}
                </div>
              )}
              {!signedIn && auth.password && (
                <form
                  data-hydrated={hydrated}
                  className="flex flex-col gap-4"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void form.handleSubmit()
                  }}
                >
                  {!signingIn && (
                    <form.Field name="name" validators={{ onChange: ({ value }) => (value.trim() ? undefined : copy.nameRequired) }}>
                      {(field) => (
                        <Field>
                          <FieldLabel htmlFor="invite-name">{t.auth.name}</FieldLabel>
                          <Input
                            id="invite-name"
                            value={field.state.value}
                            onChange={(event) => field.handleChange(event.target.value)}
                            maxLength={MAX_USER_NAME_LENGTH}
                            required
                          />
                        </Field>
                      )}
                    </form.Field>
                  )}
                  <form.Field
                    name="email"
                    validators={{ onChange: ({ value }) => (/^\S+@\S+\.\S+$/.test(value) ? undefined : copy.invalidEmail) }}
                  >
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor="invite-email">{t.auth.email}</FieldLabel>
                        <Input
                          id="invite-email"
                          type="email"
                          value={field.state.value}
                          onChange={(event) => field.handleChange(event.target.value)}
                          required
                          autoComplete="email"
                        />
                      </Field>
                    )}
                  </form.Field>
                  <form.Field name="password" validators={{ onChange: ({ value }) => passwordLengthError(value, t) }}>
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor="invite-password">{t.auth.password}</FieldLabel>
                        <Input
                          id="invite-password"
                          type="password"
                          value={field.state.value}
                          onChange={(event) => field.handleChange(event.target.value)}
                          minLength={PASSWORD_MIN_LENGTH}
                          maxLength={PASSWORD_MAX_LENGTH}
                          required
                          autoComplete={signingIn ? 'current-password' : 'new-password'}
                        />
                      </Field>
                    )}
                  </form.Field>
                  <form.Subscribe selector={(state) => state.isSubmitting}>
                    {(busy) => (
                      <Button type="submit" disabled={busy}>
                        {busy && <Spinner />}
                        {busy ? t.auth.working : signingIn ? copy.signInAndJoin : copy.createAndJoin}
                      </Button>
                    )}
                  </form.Subscribe>
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0"
                    onClick={() => {
                      setSigningIn((current) => !current)
                      setError('')
                    }}
                  >
                    {signingIn ? copy.needAccount : t.auth.haveAccount}
                  </Button>
                </form>
              )}
              {error && (
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="w-full shadow-xl shadow-black/10">
            <CardHeader>
              <CardTitle>{copy.invalidTitle}</CardTitle>
              <CardDescription>{copy.invalidDescription}</CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </main>
  )
}
