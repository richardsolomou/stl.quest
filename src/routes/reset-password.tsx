import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { AuthBrand } from '../client/components/Brand'
import { authClient } from '../client/authClient'
import { PASSWORD_MIN_LENGTH } from '../core/security'

export const Route = createFileRoute('/reset-password')({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const { token, error: tokenError } = Route.useSearch()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState(tokenError ? 'This password reset link is invalid or has expired.' : '')
  const [busy, setBusy] = useState(false)

  return (
    <main className="grid min-h-dvh place-items-center p-6 [background-image:var(--grid)] [background-size:24px_24px]">
      <div className="flex w-full max-w-[440px] flex-col gap-8">
        <AuthBrand />
        <Card>
          <CardHeader>
            <CardTitle>Reset password</CardTitle>
            <CardDescription>Choose a new password for your PrintHub account.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-4"
              onSubmit={async (event) => {
                event.preventDefault()
                if (!token) return
                setBusy(true)
                setError('')
                const { error: failed } = await authClient.resetPassword({ newPassword: password, token })
                if (failed) {
                  setError('Could not reset the password. Request a new reset link and try again.')
                  setBusy(false)
                  return
                }
                await navigate({ to: '/' })
              }}
            >
              <Field>
                <FieldLabel htmlFor="reset-password">New password</FieldLabel>
                <Input
                  id="reset-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={PASSWORD_MIN_LENGTH}
                  maxLength={256}
                  autoComplete="new-password"
                  disabled={!token}
                  required
                />
              </Field>
              {error && (
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" disabled={busy || !token}>
                {busy && <Spinner />}
                {busy ? 'Resetting…' : 'Reset password'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
