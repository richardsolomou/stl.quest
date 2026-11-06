import { useState, type ReactNode } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { Button } from '@/components/ui/button'
import { FieldDescription } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { socialProviderName, type SocialAuthProvider } from '../../../core/auth'
import { unlinkOwnAccount } from '../../../server/fns'
import { useI18n } from '../../i18n'
import { AuthMethodIcon } from '../AuthMethodIcon'
import { DialogProblem } from '../DialogProblem'
import { SettingRow } from '../SettingRow'

export function RemoveMethodForm({
  method,
  oidcName,
  onDone,
}: {
  method: 'credential' | SocialAuthProvider
  oidcName?: string
  onDone: () => void | Promise<void>
}) {
  const { t } = useI18n()
  const copy = t.account.methods
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const unlinkAccount = useServerFn(unlinkOwnAccount)
  const provider = method === 'credential' ? undefined : socialProviderName(method, oidcName)
  return (
    <div className="flex flex-col gap-4">
      <FieldDescription>{provider ? copy.unlinkWarning(provider) : copy.removePasswordWarning}</FieldDescription>
      <DialogProblem title={copy.removeFailedTitle} hint={copy.removeFailedHint} error={error} />
      <Button
        type="button"
        variant="destructive"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError('')
          try {
            await unlinkAccount({ data: { provider: method } })
            await onDone()
          } catch {
            setError(copy.removeFailed)
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy && <Spinner />}
        {busy ? copy.removing : provider ? copy.unlink(provider) : copy.removePassword}
      </Button>
    </div>
  )
}

export function MethodRow({
  method,
  name,
  linked,
  available,
  action,
}: {
  method: 'password' | SocialAuthProvider
  name: string
  linked: boolean
  available: boolean
  action?: ReactNode
}) {
  const { t } = useI18n()
  const copy = t.account.methods
  return (
    <SettingRow
      icon={<AuthMethodIcon method={method} />}
      name={name}
      status={{
        label: linked ? copy.linked : available ? copy.notLinked : copy.unavailable,
        tone: linked ? 'on' : available ? 'ready' : 'off',
      }}
      detail={linked ? copy.linkedDetail : available ? copy.availableDetail : copy.unavailableDetail}
      actions={action}
    />
  )
}
