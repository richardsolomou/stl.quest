import { CircleAlert, LoaderCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { PrintType, PublicPrintRequest } from '../../core/types'
import { printTypeLabel } from '../fleet'

export { printTypeLabel }

export function PrintTypeBadge({ printType }: { printType: PrintType }) {
  return <Badge variant="outline">{printTypeLabel(printType)}</Badge>
}

export function DisabledPrinterBadge({ request }: { request: PublicPrintRequest }) {
  if (!request.printer || request.printer.enabled) return null
  return (
    <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
      Assigned printer is disabled
    </Badge>
  )
}

export function FitAlertIcon({ request }: { request: PublicPrintRequest }) {
  if (request.fitState === 'pending') {
    return (
      <span className="text-muted-foreground" aria-label="Checking printer fit" title="Checking printer fit">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      </span>
    )
  }
  if (request.fitState === 'none' || request.fitState === 'another_compatible_printer') {
    const label = request.fitState === 'none' ? 'Fits no enabled printer' : 'Assigned printer does not fit'
    return (
      <span className="text-destructive" aria-label={label} title={label}>
        <CircleAlert className="size-4" aria-hidden="true" />
      </span>
    )
  }
  return null
}
