import { useState, type Dispatch, type SetStateAction } from 'react'
import { usePostHog } from '@posthog/react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useRouter } from '@tanstack/react-router'
import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { CardContent } from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import {
  authErrorMessage,
  signInFailureMessage,
  signInFailureReason,
  socialProviderName,
  type SignInCapabilities,
  type SocialAuthProvider,
} from '../../core/auth'
import { PASSWORD_MIN_LENGTH } from '../../core/security'
import { authClient } from '../authClient'
import { useI18n } from '../i18n'
import { hasSocialSignInError, socialSignInErrorCode, startSocialSignIn } from '../socialSignIn'
import { AuthMethodIcon } from './AuthMethodIcon'
import { PasswordAuthDivider } from './PasswordAuthDivider'
import { TwoFactorSignInForm } from './TwoFactorSignInForm'

export function AuthenticationMethods({
  auth,
  hydrated,
  initialAdmin,
  setupRequired,
  signingUp,
  creatingAccount,
  setCreatingAccount,
}: {
  auth: SignInCapabilities
  hydrated: boolean
  initialAdmin: boolean
  setupRequired: boolean
  signingUp: boolean
  creatingAccount: boolean
  setCreatingAccount: Dispatch<SetStateAction<boolean>>
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const router = useRouter()
  const posthog = usePostHog()
  const [values, setValues] = useState({ email: '', name: '', password: '' })
  const search = useLocation({ select: (location) => location.searchStr })
  const [error, setError] = useState(() => (hasSocialSignInError(search) ? t.auth.socialSignInFailed : ''))
  const [busy, setBusy] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [twoFactorPending, setTwoFactorPending] = useState(false)

  const signInWithProvider = async (provider: SocialAuthProvider) => {
    setBusy(true)
    setError('')
    const started = await startSocialSignIn({
      provider,
      callbackURL: '/',
      // Back to the screen that started sign-in, which on the hosted service is not the landing page at /.
      errorCallbackURL: window.location.pathname,
      requestSignUp: signingUp,
    })
    if (!started) {
      setError(t.auth.continueFailed(socialProviderName(provider, auth.oidcName)))
      setBusy(false)
    }
  }

  const callbackErrorCode = error === t.auth.socialSignInFailed ? socialSignInErrorCode(search) : undefined
  const failure = error ? (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertDescription>
        <p>{error}</p>
        {callbackErrorCode && (
          <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs">
            <code>{callbackErrorCode}</code>
          </pre>
        )}
      </AlertDescription>
    </Alert>
  ) : null

  return (
    <CardContent className="flex flex-col gap-4">
      {auth.socialProviders.length > 0 && (
        <div className="flex flex-col gap-2">
          {auth.socialProviders.map((provider) => (
            <Button key={provider} type="button" variant="outline" disabled={busy} onClick={() => void signInWithProvider(provider)}>
              <AuthMethodIcon method={provider} />
              {t.auth.continueWith(socialProviderName(provider, auth.oidcName))}
            </Button>
          ))}
          {auth.password && <PasswordAuthDivider />}
        </div>
      )}
      {auth.password && !twoFactorPending && (
        <form
          data-hydrated={hydrated}
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault()
            setBusy(true)
            setError('')
            try {
              const { data, error: failed } = signingUp
                ? await authClient.signUp.email(values)
                : await authClient.signIn.email({ email: values.email, password: values.password })
              if (failed) {
                if (signingUp) {
                  setError(authErrorMessage(t.auth, failed, t.auth.methods.createAccountFailed))
                } else {
                  setError(signInFailureMessage(t.auth, failed))
                  posthog.capture('user_sign_in_failed', { reason: signInFailureReason(failed) })
                }
                return
              }
              if (!signingUp && data && 'twoFactorRedirect' in data && data.twoFactorRedirect) {
                setTwoFactorPending(true)
                return
              }
              posthog.capture('user_signed_in', {
                auth_method: 'password',
                account_created: signingUp,
              })
              await queryClient.invalidateQueries({ queryKey: ['session'] })
              await router.invalidate()
            } catch {
              setError(signingUp ? t.auth.methods.createAccountFailed : t.auth.signInFailure.fallback)
            } finally {
              setBusy(false)
            }
          }}
        >
          {signingUp && (
            <Field>
              <FieldLabel htmlFor="auth-name">{t.auth.name}</FieldLabel>
              <Input
                id="auth-name"
                value={values.name}
                onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
                required
              />
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="auth-email">{t.auth.email}</FieldLabel>
            <Input
              id="auth-email"
              type="email"
              value={values.email}
              onChange={(event) => setValues((current) => ({ ...current, email: event.target.value }))}
              required
              autoComplete="email"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="auth-password">{t.auth.password}</FieldLabel>
            <Input
              id="auth-password"
              type="password"
              value={values.password}
              onChange={(event) => setValues((current) => ({ ...current, password: event.target.value }))}
              required
              minLength={signingUp ? PASSWORD_MIN_LENGTH : undefined}
              autoComplete={signingUp ? 'new-password' : 'current-password'}
            />
          </Field>
          {failure}
          <Button type="submit" disabled={busy || !hydrated}>
            {busy && <Spinner />}
            {busy ? t.auth.working : initialAdmin ? t.auth.methods.createSuperAdmin : signingUp ? t.auth.createAccount : t.auth.signIn}
          </Button>
          {!signingUp && auth.passwordReset && (
            <Button
              type="button"
              variant="link"
              className="h-auto p-0"
              disabled={busy || !values.email}
              onClick={async () => {
                setBusy(true)
                setError('')
                setResetSent(false)
                try {
                  const { error: failed } = await authClient.requestPasswordReset({
                    email: values.email,
                    redirectTo: '/reset-password',
                  })
                  if (failed) setError(t.auth.methods.resetEmailFailed)
                  else {
                    setResetSent(true)
                    posthog.capture('password_reset_requested')
                  }
                } catch {
                  setError(t.auth.methods.resetEmailFailed)
                } finally {
                  setBusy(false)
                }
              }}
            >
              {t.auth.methods.forgotPassword}
            </Button>
          )}
          {!signingUp && !auth.passwordReset && <p className="text-sm text-muted-foreground">{t.auth.methods.askAdministrator}</p>}
          {resetSent && <p className="text-sm text-muted-foreground">{t.auth.methods.resetSent}</p>}
          {!setupRequired && auth.selfSignup && (
            <Button
              type="button"
              variant="link"
              className="h-auto p-0"
              disabled={busy}
              onClick={() => {
                setCreatingAccount((current) => !current)
                setError('')
                setResetSent(false)
              }}
            >
              {creatingAccount ? t.auth.haveAccount : t.auth.methods.newAccount}
            </Button>
          )}
        </form>
      )}
      {auth.password && twoFactorPending && <TwoFactorSignInForm onBack={() => setTwoFactorPending(false)} />}
      {!auth.password && failure}
    </CardContent>
  )
}
