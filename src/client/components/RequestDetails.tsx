import type { PublicPrintRequest } from '../../core/types'
import { Badge } from '@/components/ui/badge'
import { requesterColor, requesterLabel } from '../requester'
import { FitBadge, MaterialDetails, TechnologyBadge } from './PrintTechnology'

export function RequestDetails({
  request,
  people,
  hideRequester,
  showMetadata = true,
  showTechnology = true,
  showPrinter = true,
  showSource = true,
}: {
  request: PublicPrintRequest
  people: { name: string; color?: string }[]
  hideRequester: boolean
  showMetadata?: boolean
  showTechnology?: boolean
  showPrinter?: boolean
  showSource?: boolean
}) {
  return (
    <>
      {showMetadata && (
        <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
          {showTechnology && (
            <RequestMetadata label="Technology">
              <TechnologyBadge technology={request.technology} />
            </RequestMetadata>
          )}
          <RequestMetadata label="Copies">
            <span className="font-mono">×{request.quantity}</span>
          </RequestMetadata>
          {showPrinter && (
            <RequestMetadata label="Printer">
              <span className="truncate">{request.printer?.name ?? 'Any compatible printer'}</span>
            </RequestMetadata>
          )}
          {!hideRequester && (
            <RequestMetadata label="Requester">
              <Badge variant="outline" style={{ color: requesterColor(request, people), borderColor: requesterColor(request, people) }}>
                {requesterLabel(request)}
              </Badge>
            </RequestMetadata>
          )}
        </div>
      )}
      <div className="mb-3">
        <FitBadge request={request} />
      </div>
      <div className="mb-3">
        <MaterialDetails request={request} />
      </div>
      {showSource && request.sourceUrl && (
        <p className="mb-3 text-sm">
          Source:{' '}
          <a
            className="break-all text-muted-foreground underline hover:text-foreground"
            href={request.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {sourceLabel(request.sourceUrl)}
          </a>
        </p>
      )}
    </>
  )
}

function RequestMetadata({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-md bg-muted/30 p-2">
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
