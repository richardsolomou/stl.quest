import type { PublicPrintRequest } from '../../core/types'
import type { WorkflowDefinition } from '../../core/workflow'
import { Badge } from '@/components/ui/badge'
import { requesterColor, requesterLabel } from '../requester'
import { formatResinMl, RESIN_ESTIMATE_DESCRIPTION, resinVolumeMl } from '../../core/resin'

export function RequestDetails({
  request,
  workflow,
  people,
  hideRequester,
  showSource = true,
}: {
  request: PublicPrintRequest
  workflow: WorkflowDefinition
  people: { name: string; color?: string }[]
  hideRequester: boolean
  showSource?: boolean
}) {
  const resinMl = resinVolumeMl(request)
  const totalResinMl = resinVolumeMl(request, request.quantity)

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Badge variant="outline">×{request.quantity}</Badge>
        {request.printer && <Badge variant="outline">{request.printer.name}</Badge>}
        {resinMl !== undefined && (
          <Badge variant="outline" title={RESIN_ESTIMATE_DESCRIPTION}>
            ≈{formatResinMl(resinMl)} ml resin each
          </Badge>
        )}
        {request.quantity > 1 && totalResinMl !== undefined && (
          <Badge variant="outline" title={RESIN_ESTIMATE_DESCRIPTION}>
            ≈{formatResinMl(totalResinMl)} ml total
          </Badge>
        )}
        {workflow.statuses
          .filter((status) => request.counts[status.id] > 0)
          .map((status) => (
            <Badge key={status.id} variant="secondary">
              {request.counts[status.id]} {status.label.toLowerCase()}
            </Badge>
          ))}
        {!hideRequester && (
          <Badge variant="outline" style={{ color: requesterColor(request, people), borderColor: requesterColor(request, people) }}>
            {requesterLabel(request)}
          </Badge>
        )}
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

function sourceLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
