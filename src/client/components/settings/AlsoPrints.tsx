import type { ReactNode } from 'react'
import type { PrintType } from '../../../core/types'
import { useI18n } from '../../i18n'

/** A print type the workspace does not print, folded to one quiet invitation instead of an empty section. */
export function AlsoPrints({ printType, children }: { printType: PrintType; children: ReactNode }) {
  const copy = useI18n().t.settings.alsoPrints
  return (
    <div className="flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
      {copy[printType]}
      {children}
    </div>
  )
}
