import type { PublicPrintRequest } from '../../core/types'
import { Badge } from '@/components/ui/badge'
import { requesterColor, requesterLabel } from '../requester'
import { DetailRow } from './DetailRow'
import { PrintTypeBadge } from './PrintType'
import { PrintEstimateDetails } from './PrintEstimate'
import { RequestCostEstimate } from './RequestCostEstimate'
import { ExternalLink } from 'lucide-react'
import { useI18n } from '../i18n'

export function RequestDetails({
  request,
  people,
  hideRequester,
  showCost,
}: {
  request: PublicPrintRequest
  people: { id: string; name: string; color?: string }[]
  hideRequester: boolean
  showCost: boolean
}) {
  const { t } = useI18n()
  return (
    <dl>
      <DetailRow label={t.requests.fields.printer}>
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {request.printType && <PrintTypeBadge printType={request.printType} />}
          <span className="min-w-0 break-words">
            {request.printer?.name ?? (request.printType ? t.requests.details.anyCompatiblePrinter : t.requests.details.decideLater)}
          </span>
        </span>
      </DetailRow>
      <DetailRow label={t.requests.fields.copies}>
        <span className="font-mono">×{request.quantity}</span>
      </DetailRow>
      {!hideRequester && (
        <DetailRow label={t.requests.fields.requester}>
          <Badge
            variant="outline"
            className="ph-no-capture"
            style={{ color: requesterColor(request, people), borderColor: requesterColor(request, people) }}
          >
            {requesterLabel(request, t.requests.requesterFallback)}
          </Badge>
        </DetailRow>
      )}
      <PrintEstimateDetails request={request} />
      {showCost && <RequestCostEstimate request={request} />}
      {request.sourceUrl && (
        <DetailRow label={t.requests.fields.source}>
          <a
            className="inline-flex max-w-full items-center gap-1.5 break-all font-medium text-primary underline underline-offset-4 hover:text-primary/80"
            href={request.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t.requests.details.openSourceLink}
          >
            {sourceLabel(request.sourceUrl)}
            <ExternalLink className="size-3.5 shrink-0" />
          </a>
          {!request.hasFile && <p className="mt-0.5 text-xs text-muted-foreground">{t.requests.details.linkOnly}</p>}
        </DetailRow>
      )}
      {request.notes && (
        <DetailRow label={t.requests.fields.notes}>
          <p className="whitespace-pre-wrap break-words leading-relaxed">{request.notes}</p>
        </DetailRow>
      )}
    </dl>
  )
}

function sourceLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
