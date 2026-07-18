import { useEffect, useRef, useState } from 'react'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { attachClosestEdge, extractClosestEdge, type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { canDropOnRequest } from '../boardDrag'
import { requesterColor, requesterLabel } from '../requester'
import type { StatusId } from '../../core/workflow'
import type { PublicPrintRequest } from '../../core/types'
import { LazyThumb } from './LazyThumb'
import { FitAlertIcon, printTypeLabel } from './PrintType'

export function RequestCard({
  request,
  status,
  count,
  canDrag,
  settling,
  showPrintType = false,
  showPrinter = false,
  showRequester = false,
  selected = false,
  selectable = false,
  annotation,
  onSelectedChange,
  onOpen,
}: {
  request: PublicPrintRequest
  status: StatusId
  count: number
  canDrag: boolean
  settling: boolean
  showPrintType?: boolean
  showPrinter?: boolean
  showRequester?: boolean
  selected?: boolean
  selectable?: boolean
  annotation?: string
  onSelectedChange?: (selected: boolean) => void
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
          if (canDropOnRequest(source.data, { requesterId: request.requesterId, requestId: request.id })) {
            setClosestEdge(extractClosestEdge(self.data))
          } else {
            setClosestEdge(null)
          }
        },
        onDragLeave: () => setClosestEdge(null),
        onDrop: () => setClosestEdge(null),
      }),
    )
  }, [canDrag, request.id, request.requesterId, status])

  return (
    <div className="relative [&:hover>[data-selection-checkbox]]:opacity-100">
      <Button
        ref={ref}
        type="button"
        variant="outline"
        className={cn(
          'card relative h-auto w-full justify-start gap-2.5 rounded-lg bg-secondary p-2.5 text-left transition-[border-color,transform,opacity,box-shadow] duration-200 hover:bg-secondary hover:text-foreground',
          canDrag && 'cursor-grab touch-manipulation',
          selected && 'border-primary bg-primary/10 ring-1 ring-primary/30',
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
            {showPrintType && request.printType && <span>{printTypeLabel(request.printType)}</span>}
            <span className={cn('font-mono', showPrintType && 'ml-auto')}>
              {count === request.quantity ? `×${count}` : `×${count} of ${request.quantity}`}
            </span>
            {annotation && <span className="basis-full text-primary">{annotation}</span>}
            {showRequester && (
              <span className="flex min-w-0 basis-full items-center gap-1.5" title={`For ${requesterLabel(request)}`}>
                <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: requesterColor(request, []) }} />
                <span className="truncate">For {requesterLabel(request)}</span>
              </span>
            )}
            {showPrinter && (
              <span className="basis-full truncate font-mono" title={request.printer?.name ?? 'Any compatible printer'}>
                {request.printer?.name ?? (request.printType ? `Any ${printTypeLabel(request.printType)} printer` : 'Decide later')}
                {request.printer && !request.printer.enabled && ' (disabled)'}
              </span>
            )}
          </div>
        </div>
      </Button>
      {selectable && (
        <Checkbox
          data-selection-checkbox
          checked={selected}
          aria-label={`${selected ? 'Remove' : 'Add'} ${request.name} ${selected ? 'from' : 'to'} planning selection`}
          className={cn(
            'absolute top-2.5 right-2.5 z-2 size-5 bg-background opacity-0 shadow-sm transition-opacity focus-visible:opacity-100 max-[900px]:hidden',
            selected && 'opacity-100',
          )}
          onCheckedChange={(checked) => onSelectedChange?.(checked)}
        />
      )}
    </div>
  )
}
