import { useEffect, useRef, useState } from 'react'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { attachClosestEdge, extractClosestEdge, type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
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
  onOpen,
}: {
  request: PublicPrintRequest
  status: StatusId
  count: number
  canDrag: boolean
  settling: boolean
  showPrintType?: boolean
  showPrinter?: boolean
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
        getInitialData: () => ({ requestId: request.id, from: status }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
      }),
      dropTargetForElements({
        element,
        getData: ({ input, element: el }) =>
          attachClosestEdge({ type: 'card', requestId: request.id, status }, { input, element: el, allowedEdges: ['top', 'bottom'] }),
        onDrag: ({ self, source }) => {
          if (source.data.requestId !== request.id || source.data.from !== status) {
            setClosestEdge(extractClosestEdge(self.data))
          }
        },
        onDragLeave: () => setClosestEdge(null),
        onDrop: () => setClosestEdge(null),
      }),
    )
  }, [canDrag, request.id, status])

  return (
    <Button
      ref={ref}
      type="button"
      variant="outline"
      className={cn(
        'card relative h-auto w-full justify-start gap-2.5 rounded-lg bg-secondary p-2.5 text-left transition-[border-color,transform,opacity,box-shadow] duration-200 hover:bg-secondary hover:text-foreground',
        canDrag && 'cursor-grab touch-manipulation',
        dragging && 'dragging scale-[0.985] opacity-40',
        settling && 'animate-[card-settle_240ms_ease-out]',
        closestEdge === 'top' && 'shadow-[0_-2px_0_0_var(--primary)]',
        closestEdge === 'bottom' && 'shadow-[0_2px_0_0_var(--primary)]',
      )}
      data-draggable={canDrag}
      data-edge={closestEdge ?? undefined}
      onClick={onOpen}
    >
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
          {showPrinter && (
            <span className="basis-full truncate font-mono" title={request.printer?.name ?? 'Any compatible printer'}>
              {request.printer?.name ?? (request.printType ? `Any ${printTypeLabel(request.printType)} printer` : 'Decide later')}
              {request.printer && !request.printer.enabled && ' (disabled)'}
            </span>
          )}
        </div>
      </div>
    </Button>
  )
}
