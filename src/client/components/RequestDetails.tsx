import type { PublicPrintRequest } from '../../core/types'
import { Badge } from '@/components/ui/badge'
import { requesterColor, requesterLabel } from '../requester'
import { PrintTypeBadge } from './PrintType'

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
          {showPrintType && request.printType && (
            <RequestMetadata label="Print type">
              <PrintTypeBadge printType={request.printType} />
            </RequestMetadata>
          )}
          <RequestMetadata label="Copies">
            <span className="font-mono">×{request.quantity}</span>
          </RequestMetadata>
          {showPrinter && (
            <RequestMetadata label="Printer">
              <span className="truncate">
                {request.printer?.name ??
                  (request.printType ? `Any ${request.printType === 'resin' ? 'Resin' : 'Filament'} printer` : 'Decide later')}
              </span>
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
