import { useEffect, useState } from 'react'
import { usePostHog } from '@posthog/react'
import QRCode from 'qrcode'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { authClient } from '../../authClient'
import { useI18n } from '../../i18n'
import { DialogProblem } from '../DialogProblem'
import { useCopied } from '../useCopied'

export function TwoFactorSetupForm({ onDone }: { onDone: () => void | Promise<void> }) {
  const { t } = useI18n()
  const text = t.account.twoFactor
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
        <FieldDescription>{text.saveCodes}</FieldDescription>
        <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-3 font-mono text-sm">
          {backupCodes.map((backupCode) => (
            <span key={backupCode}>{backupCode}</span>
          ))}
        </div>
        <Button type="button" variant="outline" onClick={() => copy(backupCodes.join('\n'))}>
          {copied ? (
            <>
              <Check /> {text.codesCopied}
            </>
          ) : (
            text.copyCodes
          )}
        </Button>
        <Button type="button" onClick={() => void onDone()}>
          {text.savedCodes}
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
          const { data, error: failed } = await authClient.twoFactor.enable({ method: 'totp', password })
          if (failed || data?.method !== 'totp') setError(text.startFailed)
          else {
            setTotpURI(data.totpURI)
            setBackupCodes(data.backupCodes)
            setPassword('')
          }
          setBusy(false)
        }}
      >
        <Field>
          <FieldLabel htmlFor="two-factor-password">{text.confirmPassword}</FieldLabel>
          <Input
            id="two-factor-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        <DialogProblem title={text.startFailedTitle} hint={text.startFailedHint} error={error} />
        <Button type="submit" disabled={busy || !password}>
          {busy && <Spinner />}
          {busy ? text.starting : t.common.continue}
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
        if (failed) setError(text.codeInvalid)
        else {
          setVerified(true)
          posthog.capture('two_factor_enabled')
        }
        setBusy(false)
      }}
    >
      <FieldDescription>{text.scan}</FieldDescription>
      {qrCode && <img src={qrCode} alt={text.qrAlt} className="mx-auto size-60 rounded-lg border bg-white p-2" />}
      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer">{text.cannotScan}</summary>
        <code className="mt-2 block break-all rounded bg-muted p-2 text-xs">{totpURI}</code>
      </details>
      <Field>
        <FieldLabel htmlFor="two-factor-setup-code">{text.code}</FieldLabel>
        <Input
          id="two-factor-setup-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          required
        />
      </Field>
      <DialogProblem title={text.codeRejectedTitle} hint={text.codeRejectedHint} error={error} />
      <Button type="submit" disabled={busy || !code.trim()}>
        {busy && <Spinner />}
        {busy ? text.verifying : text.verify}
      </Button>
    </form>
  )
}

export function DisableTwoFactorForm({ onDone }: { onDone: () => void | Promise<void> }) {
  const { t } = useI18n()
  const copy = t.account.twoFactor
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
        if (failed) setError(copy.disableFailed)
        else {
          posthog.capture('two_factor_disabled')
          await onDone()
        }
        setBusy(false)
      }}
    >
      <FieldDescription>{copy.disableDescription}</FieldDescription>
      <Field>
        <FieldLabel htmlFor="disable-two-factor-password">{copy.confirmPassword}</FieldLabel>
        <Input
          id="disable-two-factor-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
      </Field>
      <DialogProblem title={copy.stillOnTitle} hint={copy.stillOnHint} error={error} />
      <Button type="submit" variant="destructive" disabled={busy || !password}>
        {busy && <Spinner />}
        {busy ? copy.disabling : copy.disable}
      </Button>
    </form>
  )
}
