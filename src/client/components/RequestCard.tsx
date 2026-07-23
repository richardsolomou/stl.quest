import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { attachClosestEdge, extractClosestEdge, type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { canDropOnRequest, canShowRequestDropEdge } from '../boardDrag'
import { requesterLabel } from '../requester'
import type { StatusId } from '../../core/workflow'
import type { PublicPrintRequest } from '../../core/types'
import { LazyThumb } from './LazyThumb'
import { FitAlertIcon } from './PrintType'
import { printTypeLabel } from './PrintType'
import { UserAvatar } from './UserAvatar'

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
  selected = false,
  selectionMode = false,
  selectedRequestIds,
  onOpen,
  onSelect,
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
  selected?: boolean
  selectionMode?: boolean
  selectedRequestIds?: string[]
  onOpen: () => void
  onSelect?: (options: { range: boolean; toggle: boolean }) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [dragging, setDragging] = useState(false)
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null)
  const longPressTimer = useRef<number | undefined>(undefined)
  const pointerStart = useRef<{ x: number; y: number } | undefined>(undefined)
  const suppressClick = useRef(false)

  const cancelLongPress = () => {
    if (longPressTimer.current !== undefined) window.clearTimeout(longPressTimer.current)
    longPressTimer.current = undefined
    pointerStart.current = undefined
  }

  const finishPointer = () => {
    cancelLongPress()
    if (suppressClick.current) window.setTimeout(() => (suppressClick.current = false))
  }

  useEffect(() => {
    const element = ref.current
    if (!element || !canDrag) return
    return combine(
      draggable({
        element,
        getInitialData: () => ({ requestId: request.id, requesterId: request.requesterId, from: status, selectedRequestIds }),
        onDragStart: () => {
          cancelLongPress()
          setDragging(true)
        },
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
          const groupMove = Array.isArray(source.data.selectedRequestIds) && source.data.selectedRequestIds.length > 1
          if (
            !groupMove &&
            canShowRequestDropEdge(source.data.from, status, reorderEnabled && sourceCanReorder) &&
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
  }, [canDrag, reorderableRequestIds, reorderEnabled, request.id, request.requesterId, selectedRequestIds, status])

  useEffect(() => cancelLongPress, [])

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    if (selectionMode || event.shiftKey || event.metaKey || event.ctrlKey) {
      onSelect?.({ range: event.shiftKey, toggle: selectionMode || event.metaKey || event.ctrlKey })
      return
    }
    onOpen()
  }

  return (
    <div className="relative">
      <Button
        ref={ref}
        type="button"
        variant="outline"
        className={cn(
          'card relative h-auto w-full justify-start gap-2.5 rounded-lg border-2 border-transparent bg-ticket p-2.5 text-left text-ticket-foreground shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-[border-color,transform,opacity,box-shadow] duration-200 hover:bg-ticket hover:text-ticket-foreground',
          canDrag && 'cursor-grab touch-manipulation',
          dragging && 'dragging scale-[0.985] opacity-40',
          settling && 'animate-[card-settle_240ms_ease-out]',
          selected && 'border-primary bg-primary/15 ring-4 ring-primary/25 hover:bg-primary/15 hover:text-ticket-foreground',
        )}
        aria-pressed={selectionMode ? selected : undefined}
        data-draggable={canDrag}
        data-edge={closestEdge ?? undefined}
        data-request-name={request.name}
        onClick={handleClick}
        onPointerDown={(event) => {
          if (event.pointerType === 'mouse' || !onSelect) return
          pointerStart.current = { x: event.clientX, y: event.clientY }
          longPressTimer.current = window.setTimeout(() => {
            suppressClick.current = true
            longPressTimer.current = undefined
            onSelect({ range: false, toggle: selectionMode })
          }, 500)
        }}
        onPointerMove={(event) => {
          const start = pointerStart.current
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) cancelLongPress()
        }}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
      >
        {closestEdge && (
          <span
            aria-hidden="true"
            data-drop-indicator
            className={cn(
              'pointer-events-none absolute right-0 left-0 z-10 h-0.5 rounded-full bg-blueprint',
              closestEdge === 'top' ? 'bottom-full -translate-y-[3px]' : 'top-full translate-y-[3px]',
            )}
          />
        )}
        {request.hasThumbnail ? (
          <LazyThumb requestId={request.id} />
        ) : (
          <div className="thumb grid size-16 shrink-0 place-items-center overflow-hidden rounded-sm border border-ticket-foreground/15 bg-background [background-image:var(--grid)] [background-size:12px_12px]">
            <span className="font-mono text-[10px] text-muted-foreground">stl</span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-1.5">
            <div className="min-w-0 flex-1 truncate font-serif text-base font-semibold">{request.name}</div>
            <FitAlertIcon request={request} />
          </div>
          <div className="mt-1.5 flex min-w-0 items-center gap-x-2 text-xs text-ticket-muted">
            {(showPrintType || showPrinter) && request.printType && (
              <span className="min-w-0 flex-1 truncate" title={request.printer?.name}>
                {printTypeLabel(request.printType)}
                {showPrinter && request.printer && ` - ${request.printer.name}`}
              </span>
            )}
            <span className="ml-auto shrink-0 font-mono">
              {count === request.quantity ? `×${count}` : `×${count} of ${request.quantity}`}
            </span>
          </div>
          {annotation && <div className="mt-1 text-xs font-medium text-primary">{annotation}</div>}
          {showRequester && (
            <div
              className="mt-1 w-fit rounded-full"
              aria-label={`Requested by ${requesterLabel(request)}`}
              title={`Requested by ${requesterLabel(request)}`}
            >
              <UserAvatar name={requesterLabel(request)} image={request.requesterImage} size="sm" />
            </div>
          )}
        </div>
      </Button>
    </div>
  )
}
