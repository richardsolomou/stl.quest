import { useState, type Dispatch, type SetStateAction } from 'react'
import { usePostHog } from '@posthog/react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { CardContent } from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import {
  SOCIAL_AUTH_PROVIDER_NAMES,
  signInFailureMessage,
  signInFailureReason,
  type AuthCapabilities,
  type SocialAuthProvider,
} from '../../core/auth'
import { PASSWORD_MIN_LENGTH } from '../../core/security'
import { authClient } from '../authClient'
import { errorMessage } from '../../core/error'
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
  auth: AuthCapabilities
  hydrated: boolean
  initialAdmin: boolean
  setupRequired: boolean
  signingUp: boolean
  creatingAccount: boolean
  setCreatingAccount: Dispatch<SetStateAction<boolean>>
}) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const posthog = usePostHog()
  const [values, setValues] = useState({ email: '', name: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [twoFactorPending, setTwoFactorPending] = useState(false)

  const signInWithProvider = async (provider: SocialAuthProvider) => {
    setBusy(true)
    setError('')
    const { error: failed } = await authClient.signIn.social({
      provider,
      callbackURL: '/',
      errorCallbackURL: '/',
      requestSignUp: signingUp,
    })
    if (failed) {
      setError(`Could not continue with ${SOCIAL_AUTH_PROVIDER_NAMES[provider]}.`)
      setBusy(false)
    }
  }

  return (
    <CardContent className="flex flex-col gap-4">
      {auth.socialProviders.length > 0 && (
        <div className="flex flex-col gap-2">
          {auth.socialProviders.map((provider) => (
            <Button key={provider} type="button" variant="outline" disabled={busy} onClick={() => void signInWithProvider(provider)}>
              <AuthMethodIcon method={provider} />
              Continue with {SOCIAL_AUTH_PROVIDER_NAMES[provider]}
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
                  setError(errorMessage(failed, 'Could not create account.'))
                } else {
                  setError(signInFailureMessage(failed))
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
            } finally {
              setBusy(false)
            }
          }}
        >
          {signingUp && (
            <Field>
              <FieldLabel htmlFor="auth-name">Name</FieldLabel>
              <Input
                id="auth-name"
                value={values.name}
                onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
                required
              />
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="auth-email">Email</FieldLabel>
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
            <FieldLabel htmlFor="auth-password">Password</FieldLabel>
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
          {error && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={busy || !hydrated}>
            {busy && <Spinner />}
            {busy ? 'Working…' : initialAdmin ? 'Create super admin' : signingUp ? 'Create account' : 'Sign in'}
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
                const { error: failed } = await authClient.requestPasswordReset({
                  email: values.email,
                  redirectTo: '/reset-password',
                })
                if (failed) setError('Could not send a password reset email.')
                else {
                  setResetSent(true)
                  posthog.capture('password_reset_requested')
                }
                setBusy(false)
              }}
            >
              Forgot password?
            </Button>
          )}
          {!signingUp && !auth.passwordReset && (
            <p className="text-sm text-muted-foreground">Forgot your password? Ask your administrator to reset it for you.</p>
          )}
          {resetSent && <p className="text-sm text-muted-foreground">If that account exists, a reset link has been sent.</p>}
          {!setupRequired && (
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
              {creatingAccount ? 'Already have an account? Sign in' : 'New to STL Quest? Create an account'}
            </Button>
          )}
        </form>
      )}
      {auth.password && twoFactorPending && <TwoFactorSignInForm onBack={() => setTwoFactorPending(false)} />}
      {!auth.password && error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </CardContent>
  )
}
