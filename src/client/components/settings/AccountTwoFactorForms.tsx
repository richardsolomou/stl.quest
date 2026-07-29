import { useEffect, useState } from 'react'
import { usePostHog } from '@posthog/react'
import QRCode from 'qrcode'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { authClient } from '../../authClient'
import { DialogProblem } from '../DialogProblem'
import { useCopied } from '../useCopied'

export function TwoFactorSetupForm({ onDone }: { onDone: () => void | Promise<void> }) {
  const posthog = usePostHog()
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [totpURI, setTotpURI] = useState('')
  const [qrCode, setQrCode] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [verified, setVerified] = useState(false)
  const { copied, copy } = useCopied()

  useEffect(() => {
    if (!totpURI) return
    void QRCode.toDataURL(totpURI, { width: 240, margin: 1 }).then(setQrCode)
  }, [totpURI])

  if (verified) {
    return (
      <div className="flex flex-col gap-4">
        <FieldDescription>
          Save these one-time recovery codes somewhere secure. Each code can be used once if your authenticator is unavailable.
        </FieldDescription>
        <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-3 font-mono text-sm">
          {backupCodes.map((backupCode) => (
            <span key={backupCode}>{backupCode}</span>
          ))}
        </div>
        <Button type="button" variant="outline" onClick={() => copy(backupCodes.join('\n'))}>
          {copied ? (
            <>
              <Check /> Recovery codes copied
            </>
          ) : (
            'Copy recovery codes'
          )}
        </Button>
        <Button type="button" onClick={() => void onDone()}>
          I saved my recovery codes
        </Button>
      </div>
    )
  }

  if (!totpURI) {
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault()
          setBusy(true)
          setError('')
          const { data, error: failed } = await authClient.twoFactor.enable({ password })
          if (failed || !data) setError('Could not start setup. Check your password and try again.')
          else {
            setTotpURI(data.totpURI)
            setBackupCodes(data.backupCodes)
            setPassword('')
          }
          setBusy(false)
        }}
      >
        <Field>
          <FieldLabel htmlFor="two-factor-password">Confirm your password</FieldLabel>
          <Input
            id="two-factor-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        <DialogProblem title="Setup could not start" hint="Two-factor authentication is still off. Check your password." error={error} />
        <Button type="submit" disabled={busy || !password}>
          {busy && <Spinner />}
          {busy ? 'Starting…' : 'Continue'}
        </Button>
      </form>
    )
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault()
        setBusy(true)
        setError('')
        const { error: failed } = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, '') })
        if (failed) setError('That authenticator code is invalid. Check the app and try again.')
        else {
          setVerified(true)
          posthog.capture('two_factor_enabled')
        }
        setBusy(false)
      }}
    >
      <FieldDescription>Scan this QR code in your authenticator app, then enter its current code to finish setup.</FieldDescription>
      {qrCode && <img src={qrCode} alt="Authenticator setup QR code" className="mx-auto size-60 rounded-lg border bg-white p-2" />}
      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer">Cannot scan the QR code?</summary>
        <code className="mt-2 block break-all rounded bg-muted p-2 text-xs">{totpURI}</code>
      </details>
      <Field>
        <FieldLabel htmlFor="two-factor-setup-code">Authenticator code</FieldLabel>
        <Input
          id="two-factor-setup-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          required
        />
      </Field>
      <DialogProblem
        title="That code was not accepted"
        hint="Codes expire every 30 seconds, so wait for the next one. Check your phone's clock is set automatically."
        error={error}
      />
      <Button type="submit" disabled={busy || !code.trim()}>
        {busy && <Spinner />}
        {busy ? 'Verifying…' : 'Verify and enable'}
      </Button>
    </form>
  )
}

export function DisableTwoFactorForm({ onDone }: { onDone: () => void | Promise<void> }) {
  const posthog = usePostHog()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault()
        setBusy(true)
        setError('')
        const { error: failed } = await authClient.twoFactor.disable({ password })
        if (failed) setError('Could not disable two-factor authentication. Check your password and try again.')
        else {
          posthog.capture('two_factor_disabled')
          await onDone()
        }
        setBusy(false)
      }}
    >
      <FieldDescription>
        Your account returns to password-only sign-in and your unused recovery codes stop working. You can set up an authenticator again at
        any time.
      </FieldDescription>
      <Field>
        <FieldLabel htmlFor="disable-two-factor-password">Confirm your password</FieldLabel>
        <Input
          id="disable-two-factor-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
      </Field>
      <DialogProblem
        title="Two-factor authentication is still on"
        hint="Nothing has changed. Check your password and try again."
        error={error}
      />
      <Button type="submit" variant="destructive" disabled={busy || !password}>
        {busy && <Spinner />}
        {busy ? 'Disabling…' : 'Disable two-factor authentication'}
      </Button>
    </form>
  )
}
