import type { PublicPrintRequest } from '../../core/types'
import { Badge } from '@/components/ui/badge'
import { requesterColor, requesterLabel } from '../requester'
import { DetailRow } from './DetailRow'
import { PrintTypeBadge } from './PrintType'
import { PrintEstimateDetails } from './PrintEstimate'
import { RequestCostEstimate } from './RequestCostEstimate'
import { RequestActualCost } from './RequestActualCost'
import { RequestCharge } from './RequestCharge'
import { RequestPlates } from './plates/RequestPlates'
import { ExternalLink } from 'lucide-react'
import { useI18n } from '../i18n'
import { statusText } from '../../core/i18n'
import { workflow } from '../../core/workflow'
import { CopyCells } from './CopyCells'
import { StatusDot } from './StatusDot'
import { AgeStamp } from './AgeStamp'
import { useUsageTracking } from '../workspace'

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
  const usageTracking = useUsageTracking()
  const stages = workflow.statuses.filter(({ id }) => (request.counts[id] ?? 0) > 0)
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="font-heading text-xl/none font-bold uppercase">{t.requests.details.copyCount(request.quantity)}</span>
          {stages.map(({ id }) => (
            <span key={id} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <StatusDot status={id} />
              <span className="font-mono text-foreground">{request.counts[id]}</span>
              {statusText(t, 'label', id)}
            </span>
          ))}
        </div>
        <CopyCells counts={request.counts} />
      </section>
      {request.notes && (
        <section className="border-l-3 border-note py-0.5 pl-3">
          <h3 className="font-heading text-xs font-bold tracking-[0.015em] text-note uppercase">{t.requests.fields.notes}</h3>
          <p className="mt-0.5 font-medium whitespace-pre-wrap break-words leading-relaxed text-note">{request.notes}</p>
        </section>
      )}
      <dl>
        <DetailRow label={t.requests.fields.printer}>
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            {request.printType && <PrintTypeBadge printType={request.printType} />}
            <span className="min-w-0 break-words">
              {request.printer?.name ?? (request.printType ? t.requests.details.anyCompatiblePrinter : t.requests.details.decideLater)}
            </span>
          </span>
        </DetailRow>
        {!hideRequester && (
          <DetailRow label={t.requests.fields.requester}>
            <span className="flex flex-wrap items-center gap-2">
              <Badge className="ph-no-capture rounded-[4px] text-white" style={{ backgroundColor: requesterColor(request, people) }}>
                {requesterLabel(request, t.requests.requesterFallback)}
              </Badge>
              <AgeStamp since={request.createdAt} label={t.requests.details.submittedAgo} className="text-xs" />
            </span>
          </DetailRow>
        )}
        <PrintEstimateDetails request={request} />
        {showCost && (
          <>
            <RequestCostEstimate request={request} />
            {usageTracking && (
              <>
                <RequestActualCost requestId={request.id} people={people} />
                <RequestPlates requestId={request.id} />
                <RequestCharge request={request} />
              </>
            )}
          </>
        )}
        {request.sourceUrl && (
          <DetailRow label={t.requests.fields.source}>
            <a
              className="inline-flex max-w-full items-center gap-1.5 break-all font-medium text-foreground underline decoration-primary decoration-2 underline-offset-4 hover:decoration-foreground"
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
      </dl>
    </div>
  )
}

function sourceLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
