import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAuthAction } from 'ras-stack/auth/react'
import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { AuthBrand } from '../client/components/Brand'
import { authClient } from '../client/authClient'
import { useI18n } from '../client/i18n'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../core/security'

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
  const { t } = useI18n()
  const copy = t.auth.resetPassword
  const action = useAuthAction({ failureMessage: () => copy.failed })
  const error = tokenError ? copy.linkInvalid : action.error

  return (
    <main className="grid min-h-dvh place-items-center p-6 [background-image:var(--grid)] [background-size:24px_24px]">
      <div className="flex w-full max-w-[440px] flex-col gap-8">
        <AuthBrand />
        <Card>
          <CardHeader>
            <CardTitle>{copy.title}</CardTitle>
            <CardDescription>{copy.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-4"
              onSubmit={async (event) => {
                event.preventDefault()
                if (!token) return
                action.clearError()
                const { error: failed } = await action.run(() => authClient.resetPassword({ newPassword: password, token }))
                if (failed) return
                await navigate({ to: '/' })
              }}
            >
              <Field>
                <FieldLabel htmlFor="reset-password">{copy.newPassword}</FieldLabel>
                <Input
                  id="reset-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={PASSWORD_MIN_LENGTH}
                  maxLength={PASSWORD_MAX_LENGTH}
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
              <Button type="submit" disabled={action.busy || !token}>
                {action.busy && <Spinner />}
                {action.busy ? copy.resetting : copy.title}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
