import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { Boxes, CircleAlert, Printer, ShieldCheck } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import type { AuthCapabilities, SocialAuthProvider } from '../../core/auth'
import { PASSWORD_MIN_LENGTH } from '../../core/security'
import { authClient } from '../authClient'
import { authErrorMessage } from '../authError'
import { AuthBrand } from './Brand'
import { AuthMethodIcon } from './AuthMethodIcon'
import { OnboardingProgress } from './OnboardingProgress'

const PROVIDER_LABELS: Record<SocialAuthProvider, string> = {
  google: 'Google',
  discord: 'Discord',
}

export function AuthScreen({ setupRequired, hosted, auth }: { setupRequired: boolean; hosted: boolean; auth: AuthCapabilities }) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const [values, setValues] = useState({ email: '', name: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [twoFactorPending, setTwoFactorPending] = useState(false)
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [useRecoveryCode, setUseRecoveryCode] = useState(false)
  const [trustDevice, setTrustDevice] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [showIntroduction, setShowIntroduction] = useState(setupRequired)
  const [creatingAccount, setCreatingAccount] = useState(false)
  useEffect(() => setHydrated(true), [])
  const signingUp = setupRequired || creatingAccount
  const initialAdmin = setupRequired && !hosted

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
      setError(`Could not continue with ${PROVIDER_LABELS[provider]}.`)
      setBusy(false)
    }
  }

  if (setupRequired && showIntroduction) {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <div className="flex w-full max-w-[720px] flex-col gap-5">
          <AuthBrand />
          <OnboardingProgress step={1} accountLabel={hosted ? 'Account' : 'Admin'} />
          <Card className="shadow-xl shadow-black/10">
            <CardHeader>
              <CardTitle>Your private 3D-print production queue</CardTitle>
              <CardDescription>Accept STL requests and take resin and filament prints from upload to collection.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <IntroductionItem icon={ShieldCheck} title="Private requests">
                  Models and production history stay on storage you control.
                </IntroductionItem>
                <IntroductionItem icon={Boxes} title="Production tracking">
                  Move each copy through Queue, Printing, Finishing, and Ready.
                </IntroductionItem>
                <IntroductionItem icon={Printer} title="Printer assignment">
                  Configure resin and filament printers, then assign queued work to the right machine.
                </IntroductionItem>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3.5 text-sm text-muted-foreground">
                <p>
                  Next: {initialAdmin ? 'create the admin' : 'create your account'}, choose private storage, and add your resin or filament
                  printers.
                </p>
                <p className="mt-1">Anonymous usage telemetry is enabled by default and can be disabled in Settings.</p>
              </div>
              <Button type="button" className="self-end" disabled={!hydrated} onClick={() => setShowIntroduction(false)}>
                Set up PrintHub
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    )
  }

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="flex w-full max-w-[440px] flex-col gap-8">
        <AuthBrand />
        {setupRequired && <OnboardingProgress step={2} accountLabel={hosted ? 'Account' : 'Admin'} />}
        <Card className="w-full shadow-xl shadow-black/10">
          <CardHeader>
            <CardTitle>{initialAdmin ? 'Welcome' : signingUp ? 'Create account' : 'Sign in'}</CardTitle>
            {setupRequired && (
              <CardDescription>
                {initialAdmin
                  ? 'Create the admin account to get started. The admin runs the print queue and manages access for everyone else.'
                  : 'Create your account to get a private workspace for your print queue, members, and settings.'}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {auth.socialProviders.length > 0 && (
              <div className="flex flex-col gap-2">
                {auth.socialProviders.map((provider) => (
                  <Button key={provider} type="button" variant="outline" disabled={busy} onClick={() => void signInWithProvider(provider)}>
                    <AuthMethodIcon method={provider} />
                    Continue with {PROVIDER_LABELS[provider]}
                  </Button>
                ))}
                {auth.password && (
                  <div className="relative my-1 text-center text-xs text-muted-foreground before:absolute before:top-1/2 before:left-0 before:w-full before:border-t">
                    <span className="relative bg-card px-2">or use a password</span>
                  </div>
                )}
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
                      setError(signingUp ? authErrorMessage(failed, 'Could not create account.') : 'Email or password is incorrect.')
                      return
                    }
                    if (!signingUp && data && 'twoFactorRedirect' in data && data.twoFactorRedirect) {
                      setTwoFactorPending(true)
                      return
                    }
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
                <Button type="submit" disabled={busy}>
                  {busy && <Spinner />}
                  {busy ? 'Working…' : initialAdmin ? 'Create admin' : signingUp ? 'Create account' : 'Sign in'}
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
                      else setResetSent(true)
                      setBusy(false)
                    }}
                  >
                    Forgot password?
                  </Button>
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
                    {creatingAccount ? 'Already have an account? Sign in' : 'New to PrintHub? Create an account'}
                  </Button>
                )}
              </form>
            )}
            {auth.password && twoFactorPending && (
              <form
                className="flex flex-col gap-4"
                onSubmit={async (event) => {
                  event.preventDefault()
                  setBusy(true)
                  setError('')
                  try {
                    const { error: failed } = useRecoveryCode
                      ? await authClient.twoFactor.verifyBackupCode({ code: twoFactorCode, trustDevice })
                      : await authClient.twoFactor.verifyTotp({ code: twoFactorCode.replace(/\s/g, ''), trustDevice })
                    if (failed) {
                      setError(useRecoveryCode ? 'Recovery code is invalid or has already been used.' : 'Authenticator code is invalid.')
                      return
                    }
                    await queryClient.invalidateQueries({ queryKey: ['session'] })
                    await router.invalidate()
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <Field>
                  <FieldLabel htmlFor="two-factor-code">{useRecoveryCode ? 'Recovery code' : 'Authenticator code'}</FieldLabel>
                  <Input
                    id="two-factor-code"
                    value={twoFactorCode}
                    onChange={(event) => setTwoFactorCode(event.target.value)}
                    inputMode={useRecoveryCode ? 'text' : 'numeric'}
                    autoComplete="one-time-code"
                    required
                  />
                  <FieldDescription>
                    {useRecoveryCode
                      ? 'Enter one of the one-time codes saved during setup.'
                      : 'Enter the current 6-digit code from your authenticator app.'}
                  </FieldDescription>
                </Field>
                <Field orientation="horizontal">
                  <Checkbox id="trust-device" checked={trustDevice} onCheckedChange={setTrustDevice} />
                  <FieldLabel htmlFor="trust-device">Trust this device for 30 days</FieldLabel>
                </Field>
                {error && (
                  <Alert variant="destructive">
                    <CircleAlert />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <Button type="submit" disabled={busy || !twoFactorCode.trim()}>
                  {busy && <Spinner />}
                  {busy ? 'Verifying…' : 'Verify and sign in'}
                </Button>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0"
                  disabled={busy}
                  onClick={() => {
                    setUseRecoveryCode((current) => !current)
                    setTwoFactorCode('')
                    setError('')
                  }}
                >
                  {useRecoveryCode ? 'Use authenticator code' : 'Use a recovery code'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setTwoFactorPending(false)
                    setTwoFactorCode('')
                    setUseRecoveryCode(false)
                    setError('')
                  }}
                >
                  Back to sign in
                </Button>
              </form>
            )}
            {!auth.password && error && (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

function IntroductionItem({ icon: Icon, title, children }: { icon: typeof Printer; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-3.5">
      <Icon className="mb-2 size-5 text-primary" />
      <h3 className="font-heading font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{children}</p>
    </div>
  )
}
