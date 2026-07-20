import { useEffect, useRef, useState } from 'react'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { attachClosestEdge, extractClosestEdge, type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { canDropOnRequest } from '../boardDrag'
import { requesterColor, requesterLabel } from '../requester'
import type { StatusId } from '../../core/workflow'
import type { PublicPrintRequest } from '../../core/types'
import { LazyThumb } from './LazyThumb'
import { FitAlertIcon } from './PrintType'
import { printTypeLabel } from './PrintType'

export function RequestCard({
  request,
  reorderableRequestIds,
  status,
  count,
  canDrag,
  reorderEnabled,
  settling,
  showPrintType = false,
  showPrinter = false,
  showRequester = false,
  annotation,
  onOpen,
}: {
  request: PublicPrintRequest
  reorderableRequestIds: Set<string>
  status: StatusId
  count: number
  canDrag: boolean
  reorderEnabled: boolean
  settling: boolean
  showPrintType?: boolean
  showPrinter?: boolean
  showRequester?: boolean
  annotation?: string
  onOpen: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [dragging, setDragging] = useState(false)
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null)

  useEffect(() => {
    const element = ref.current
    if (!element || !canDrag) return
    return combine(
      draggable({
        element,
        getInitialData: () => ({ requestId: request.id, requesterId: request.requesterId, from: status }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
      }),
      dropTargetForElements({
        element,
        getData: ({ input, element: el }) =>
          attachClosestEdge(
            { type: 'card', requestId: request.id, requesterId: request.requesterId, status },
            { input, element: el, allowedEdges: ['top', 'bottom'] },
          ),
        onDrag: ({ self, source }) => {
          const sourceRequestId = source.data.requestId
          const sourceCanReorder = typeof sourceRequestId === 'string' && reorderableRequestIds.has(sourceRequestId)
          if (
            canDropOnRequest(
              source.data,
              { requesterId: request.requesterId, requestId: request.id, status },
              reorderEnabled && sourceCanReorder,
            )
          ) {
            setClosestEdge(extractClosestEdge(self.data))
          } else {
            setClosestEdge(null)
          }
        },
        onDragLeave: () => setClosestEdge(null),
        onDrop: () => setClosestEdge(null),
      }),
    )
  }, [canDrag, reorderableRequestIds, reorderEnabled, request.id, request.requesterId, status])

  return (
    <div className="relative">
      <Button
        ref={ref}
        type="button"
        variant="outline"
        className={cn(
          'card relative h-auto w-full justify-start gap-2.5 rounded-lg bg-secondary p-2.5 text-left transition-[border-color,transform,opacity,box-shadow] duration-200 hover:bg-secondary hover:text-foreground',
          canDrag && 'cursor-grab touch-manipulation',
          dragging && 'dragging scale-[0.985] opacity-40',
          settling && 'animate-[card-settle_240ms_ease-out]',
        )}
        data-draggable={canDrag}
        data-edge={closestEdge ?? undefined}
        data-request-name={request.name}
        onClick={onOpen}
      >
        {closestEdge && (
          <span
            aria-hidden="true"
            data-drop-indicator
            className={cn(
              'pointer-events-none absolute right-0 left-0 z-10 h-0.5 rounded-full bg-primary',
              closestEdge === 'top' ? 'bottom-full -translate-y-[3px]' : 'top-full translate-y-[3px]',
            )}
          />
        )}
        {request.hasThumbnail ? (
          <LazyThumb requestId={request.id} />
        ) : (
          <div className="thumb grid size-16 shrink-0 place-items-center overflow-hidden rounded-md border bg-background [background-image:var(--grid)] [background-size:12px_12px]">
            <span className="font-mono text-[10px] text-muted-foreground">stl</span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-1.5">
            <div className="min-w-0 flex-1 truncate font-semibold">{request.name}</div>
            <FitAlertIcon request={request} />
          </div>
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {(showPrintType || showPrinter) && request.printType && (
              <span className="min-w-0 truncate" title={request.printer?.name}>
                {printTypeLabel(request.printType)}
                {showPrinter && request.printer && ` - ${request.printer.name}`}
                {showPrinter && request.printer && !request.printer.enabled && ' (disabled)'}
              </span>
            )}
            <span className={cn('font-mono', (showPrintType || showPrinter) && 'ml-auto')}>
              {count === request.quantity ? `×${count}` : `×${count} of ${request.quantity}`}
            </span>
            {annotation && <span className="basis-full text-primary">{annotation}</span>}
            {showRequester && (
              <span className="flex min-w-0 basis-full items-center gap-1.5" title={`For ${requesterLabel(request)}`}>
                <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: requesterColor(request, []) }} />
                <span className="truncate">For {requesterLabel(request)}</span>
              </span>
            )}
          </div>
        </div>
      </Button>
    </div>
  )
}
