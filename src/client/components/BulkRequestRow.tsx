import type { ReactNode } from 'react'
import type { PublicPrintRequest } from '../../core/types'
import { LazyThumb } from './LazyThumb'

export function BulkRequestRow({ request, detail, action }: { request: PublicPrintRequest; detail: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-secondary/40 p-2.5">
      {request.hasThumbnail ? (
        <LazyThumb requestId={request.id} />
      ) : (
        <div className="grid size-16 shrink-0 place-items-center rounded-md border bg-background font-mono text-[10px] text-muted-foreground">
          stl
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{request.name}</div>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </div>
      {action}
    </div>
  )
}
