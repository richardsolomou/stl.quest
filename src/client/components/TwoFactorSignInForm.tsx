import { useState } from 'react'
import { usePostHog } from '@posthog/react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { authClient } from '../authClient'
import { useI18n } from '../i18n'

export function TwoFactorSignInForm({ onBack }: { onBack: () => void }) {
  const { t } = useI18n()
  const copy = t.auth.twoFactor
  const queryClient = useQueryClient()
  const router = useRouter()
  const posthog = usePostHog()
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState(false)
  const [trustDevice, setTrustDevice] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault()
        setBusy(true)
        setError('')
        try {
          const { error: failed } = recovery
            ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
            : await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, ''), trustDevice })
          if (failed) {
            setError(recovery ? copy.recoveryInvalid : copy.codeInvalid)
            return
          }
          posthog.capture('user_signed_in', {
            auth_method: recovery ? 'recovery_code' : 'totp',
            trusted_device: trustDevice,
          })
          await queryClient.invalidateQueries({ queryKey: ['session'] })
          await router.invalidate()
        } finally {
          setBusy(false)
        }
      }}
    >
      <Field>
        <FieldLabel htmlFor="two-factor-code">{recovery ? copy.recoveryCode : copy.authenticatorCode}</FieldLabel>
        <Input
          id="two-factor-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          inputMode={recovery ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          required
        />
        <FieldDescription>{recovery ? copy.recoveryHint : copy.authenticatorHint}</FieldDescription>
      </Field>
      <Field orientation="horizontal">
        <Checkbox id="trust-device" checked={trustDevice} onCheckedChange={setTrustDevice} />
        <FieldLabel htmlFor="trust-device">{copy.trustDevice}</FieldLabel>
      </Field>
      {error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={busy || !code.trim()}>
        {busy && <Spinner />}
        {busy ? copy.verifying : copy.verify}
      </Button>
      <Button
        type="button"
        variant="link"
        className="h-auto p-0"
        disabled={busy}
        onClick={() => {
          setRecovery((current) => !current)
          setCode('')
          setError('')
        }}
      >
        {recovery ? copy.useAuthenticator : copy.useRecovery}
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={busy}
        onClick={() => {
          setCode('')
          setRecovery(false)
          setError('')
          onBack()
        }}
      >
        {copy.back}
      </Button>
    </form>
  )
}
