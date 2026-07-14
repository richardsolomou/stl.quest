import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { Boxes, CircleAlert, CloudOff, Printer, ShieldCheck } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import type { AuthCapabilities, SocialAuthProvider } from '../../core/auth'
import { PASSWORD_MIN_LENGTH } from '../../core/security'
import { authClient } from '../authClient'
import { AuthBrand } from './Brand'
import { AuthMethodIcon } from './AuthMethodIcon'
import { OnboardingProgress } from './OnboardingProgress'

const PROVIDER_LABELS: Record<SocialAuthProvider, string> = {
  google: 'Google',
  discord: 'Discord',
}

export function AuthScreen({ setupRequired, auth }: { setupRequired: boolean; auth: AuthCapabilities }) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const [values, setValues] = useState({ email: '', name: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [showIntroduction, setShowIntroduction] = useState(setupRequired)
  useEffect(() => setHydrated(true), [])

  const signInWithProvider = async (provider: SocialAuthProvider) => {
    setBusy(true)
    setError('')
    const { error: failed } = await authClient.signIn.social({
      provider,
      callbackURL: '/',
      errorCallbackURL: '/',
      requestSignUp: setupRequired,
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
          <OnboardingProgress step={1} />
          <Card className="shadow-xl shadow-black/10">
            <CardHeader>
              <CardTitle>Private resin production, not a generic printer dashboard</CardTitle>
              <CardDescription>
                PrintHub helps a resin shop or lab accept private STL requests, prepare build plates, and track copies through production.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <IntroductionItem icon={ShieldCheck} title="Self-hosted and private">
                  Models, previews, accounts, and production history stay in this installation and storage you control.
                </IntroductionItem>
                <IntroductionItem icon={Boxes} title="Built for resin workflow">
                  Manage requests from queue to printing, post-processing, and collection, with resin estimates and plate planning.
                </IntroductionItem>
                <IntroductionItem icon={Printer} title="Printer-aware planning">
                  Add each resin printer's usable build volume so PrintHub can assign requests and generate compatible plates.
                </IntroductionItem>
                <IntroductionItem icon={CloudOff} title="No vendor cloud required">
                  PrintHub does not connect to, monitor, slice for, or control printers, and it is not designed for FDM production.
                </IntroductionItem>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                Setup creates the admin account, chooses model storage, and records your resin printer dimensions. Anonymous usage telemetry
                starts enabled and can be disabled in Settings at any time.
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
        {setupRequired && <OnboardingProgress step={2} />}
        <Card className="w-full shadow-xl shadow-black/10">
          <CardHeader>
            <CardTitle>{setupRequired ? 'Welcome' : 'Sign in'}</CardTitle>
            {setupRequired && (
              <CardDescription>
                Create the admin account to get started. The admin runs the print queue and manages access for everyone else.
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
            {auth.password && (
              <form
                data-hydrated={hydrated}
                className="flex flex-col gap-4"
                onSubmit={async (event) => {
                  event.preventDefault()
                  setBusy(true)
                  setError('')
                  try {
                    const { error: failed } = setupRequired
                      ? await authClient.signUp.email(values)
                      : await authClient.signIn.email({ email: values.email, password: values.password })
                    if (failed) {
                      setError(
                        setupRequired
                          ? `Check the fields and use at least ${PASSWORD_MIN_LENGTH} password characters.`
                          : 'Email or password is incorrect.',
                      )
                      return
                    }
                    await queryClient.invalidateQueries({ queryKey: ['session'] })
                    await router.invalidate()
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                {setupRequired && (
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
                    minLength={setupRequired ? PASSWORD_MIN_LENGTH : undefined}
                    autoComplete={setupRequired ? 'new-password' : 'current-password'}
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
                  {busy ? 'Working…' : setupRequired ? 'Create admin' : 'Sign in'}
                </Button>
                {!setupRequired && auth.passwordReset && (
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
    <div className="rounded-lg border bg-card p-4">
      <Icon className="mb-3 size-5 text-primary" />
      <h3 className="font-heading font-semibold">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{children}</p>
    </div>
  )
}
