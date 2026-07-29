import { useState, type ReactNode } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { Button } from '@/components/ui/button'
import { FieldDescription } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { SOCIAL_AUTH_PROVIDER_NAMES, type SocialAuthProvider } from '../../../core/auth'
import { unlinkOwnAccount } from '../../../server/fns'
import { AuthMethodIcon } from '../AuthMethodIcon'
import { DialogProblem } from '../DialogProblem'
import { SettingRow } from '../SettingRow'

export function RemoveMethodForm({ method, onDone }: { method: 'credential' | SocialAuthProvider; onDone: () => void | Promise<void> }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const unlinkAccount = useServerFn(unlinkOwnAccount)
  const label = method === 'credential' ? 'password sign-in' : SOCIAL_AUTH_PROVIDER_NAMES[method]
  return (
    <div className="flex flex-col gap-4">
      <FieldDescription>
        You will no longer be able to sign in with {label}. Your other linked sign-in methods will keep working.
      </FieldDescription>
      <DialogProblem
        title="That sign-in method was not removed"
        hint="You can still sign in with it. At least one other enabled method must stay linked."
        error={error}
      />
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
            setError('Could not remove this sign-in method. Make sure another enabled method is linked first.')
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy && <Spinner />}
        {busy ? 'Removing…' : method === 'credential' ? 'Remove password' : `Unlink ${SOCIAL_AUTH_PROVIDER_NAMES[method]}`}
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
  return (
    <SettingRow
      icon={<AuthMethodIcon method={method} />}
      name={name}
      status={{
        label: linked ? 'Linked' : available ? 'Not linked' : 'Unavailable',
        tone: linked ? 'on' : available ? 'ready' : 'off',
      }}
      detail={
        linked
          ? 'You can sign in to STL Quest with this.'
          : available
            ? 'Link this so you have another way into your account.'
            : 'An administrator has turned this sign-in method off for the whole deployment.'
      }
      actions={action}
    />
  )
}
