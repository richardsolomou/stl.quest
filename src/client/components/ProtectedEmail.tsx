import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useI18n } from '../i18n'

export function ProtectedEmail({ email, className }: { email: string; className?: string }) {
  const { t } = useI18n()
  const [revealed, setRevealed] = useState(false)

  return (
    <button
      type="button"
      className={cn('ph-no-capture max-w-full cursor-pointer text-left', className)}
      aria-label={revealed ? email : t.account.protectedEmail.reveal}
      title={revealed ? undefined : t.account.protectedEmail.revealHint}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setRevealed(true)
      }}
    >
      <span className="-m-1.5 block overflow-hidden p-1.5">
        <span className={cn('block truncate transition-[filter]', !revealed && 'select-none blur-[5px]')} aria-hidden={!revealed}>
          {email}
        </span>
      </span>
    </button>
  )
}
