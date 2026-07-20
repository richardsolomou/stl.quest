import { useEffect, useRef, useState } from 'react'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { attachClosestEdge, extractClosestEdge, type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { Menu } from '@base-ui/react/menu'
import { Ellipsis } from 'lucide-react'
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
  onMove,
  onMoveEarlier,
  onMoveLater,
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
  onMove?: () => void
  onMoveEarlier?: () => void
  onMoveLater?: () => void
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
            source.data.from === status &&
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
          'card relative h-auto w-full justify-start gap-2.5 rounded-lg bg-secondary p-2.5 pr-10 text-left transition-[border-color,transform,opacity,box-shadow] duration-200 hover:bg-secondary hover:text-foreground',
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
          <div className="mt-1.5 flex min-w-0 items-center gap-x-2 text-xs text-muted-foreground">
            {(showPrintType || showPrinter) && request.printType && (
              <span className="min-w-0 flex-1 truncate" title={request.printer?.name}>
                {printTypeLabel(request.printType)}
                {showPrinter && request.printer && ` - ${request.printer.name}`}
                {showPrinter && request.printer && !request.printer.enabled && ' (disabled)'}
              </span>
            )}
            <span className="ml-auto shrink-0 font-mono">
              {count === request.quantity ? `×${count}` : `×${count} of ${request.quantity}`}
            </span>
          </div>
          {annotation && <div className="mt-1 text-xs text-primary">{annotation}</div>}
          {showRequester && (
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" title={`For ${requesterLabel(request)}`}>
              <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: requesterColor(request, []) }} />
              <span className="truncate">For {requesterLabel(request)}</span>
            </div>
          )}
        </div>
      </Button>
      {(onMove || onMoveEarlier || onMoveLater) && (
        <Menu.Root>
          <Menu.Trigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="absolute top-2 right-2 z-10 bg-secondary/90"
                aria-label={`Queue actions for ${request.name}`}
              />
            }
          >
            <Ellipsis />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner align="end" sideOffset={6} className="isolate z-50">
              <Menu.Popup className="min-w-32 rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
                {onMove && (
                  <Menu.Item
                    className="flex h-8 cursor-default items-center rounded-md px-2 outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                    onClick={onMove}
                  >
                    Move to…
                  </Menu.Item>
                )}
                {onMoveEarlier && (
                  <Menu.Item
                    className="flex h-8 cursor-default items-center rounded-md px-2 outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                    onClick={onMoveEarlier}
                  >
                    Earlier
                  </Menu.Item>
                )}
                {onMoveLater && (
                  <Menu.Item
                    className="flex h-8 cursor-default items-center rounded-md px-2 outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                    onClick={onMoveLater}
                  >
                    Later
                  </Menu.Item>
                )}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      )}
    </div>
  )
}
