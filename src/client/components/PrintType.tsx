import { CircleAlert, LoaderCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { PrintType, PublicPrintRequest } from '../../core/types'
import { printTypeLabel } from '../fleet'
import { useI18n } from '../i18n'

export { printTypeLabel }

export function PrintTypeBadge({ printType }: { printType: PrintType }) {
  const { t } = useI18n()
  return <Badge variant="outline">{printTypeLabel(t, printType)}</Badge>
}

export function FitAlertIcon({ request }: { request: PublicPrintRequest }) {
  const { t } = useI18n()
  if (request.fitState === 'pending') {
    return (
      <span className="text-ticket-muted" aria-label={t.requests.fit.checking} title={t.requests.fit.checking}>
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      </span>
    )
  }
  if (request.fitState === 'none' || request.fitState === 'another_compatible_printer') {
    const label = request.fitState === 'none' ? t.requests.fit.fitsNoPrinter : t.requests.fit.assignedDoesNotFit
    return (
      <span className="text-destructive" aria-label={label} title={label}>
        <CircleAlert className="size-4" aria-hidden="true" />
      </span>
    )
  }
  return null
}
