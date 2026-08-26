import type { PublicPrintRequest } from '../../core/types'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { requesterColor, requesterLabel } from '../requester'
import { PrintTypeBadge } from './PrintType'
import { PrintEstimateDetails } from './PrintEstimate'
import { ExternalLink } from 'lucide-react'

export function RequestDetails({
  request,
  people,
  hideRequester,
  showMetadata = true,
  showPrintType = true,
  showPrinter = true,
  showSource = true,
}: {
  request: PublicPrintRequest
  people: { id: string; name: string; color?: string }[]
  hideRequester: boolean
  showMetadata?: boolean
  showPrintType?: boolean
  showPrinter?: boolean
  showSource?: boolean
}) {
  return (
    <>
      {showMetadata && (
        <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
          {showPrinter ? (
            <RequestMetadata label="Printer" wide>
              <span className="flex min-w-0 items-center gap-1.5">
                {showPrintType && request.printType && <PrintTypeBadge printType={request.printType} />}
                <span className="truncate">{request.printer?.name ?? (request.printType ? 'Any compatible printer' : 'Decide later')}</span>
              </span>
            </RequestMetadata>
          ) : (
            showPrintType &&
            request.printType && (
              <RequestMetadata label="Print type">
                <PrintTypeBadge printType={request.printType} />
              </RequestMetadata>
            )
          )}
          <RequestMetadata label="Copies">
            <span className="font-mono">×{request.quantity}</span>
          </RequestMetadata>
          {!hideRequester && (
            <RequestMetadata label="Requester">
              <Badge
                variant="outline"
                className="ph-no-capture"
                style={{ color: requesterColor(request, people), borderColor: requesterColor(request, people) }}
              >
                {requesterLabel(request)}
              </Badge>
            </RequestMetadata>
          )}
        </div>
      )}
      <PrintEstimateDetails request={request} />
      {showSource && request.sourceUrl && (
        <div className="mb-3">
          <div className="mb-1 text-xs text-muted-foreground">Source</div>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
            <a
              className="inline-flex max-w-full items-center gap-1.5 break-all font-medium text-primary underline underline-offset-4 hover:text-primary/80"
              href={request.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open source link"
            >
              {sourceLabel(request.sourceUrl)}
              <ExternalLink className="size-3.5 shrink-0" />
            </a>
            {!request.hasFile && <span className="text-xs text-muted-foreground">Link only — no model file is stored.</span>}
          </div>
        </div>
      )}
    </>
  )
}

function RequestMetadata({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('min-w-0 rounded-md bg-muted/30 p-2', wide && 'col-span-2')}>
      <div className="mb-1 text-xs text-muted-foreground">{label}</div>
      <div className="min-w-0">{children}</div>
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
