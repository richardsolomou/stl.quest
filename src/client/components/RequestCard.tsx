import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { attachClosestEdge, extractClosestEdge, type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { Button } from '@/components/ui/button'
import { Check, Download, Layers3, Move, RotateCcw, Trash2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { boardDropEffect, canDropOnRequest, canShowRequestDropEdge } from '../boardDrag'
import { requesterLabel } from '../requester'
import { signalProductTourProgress } from '../productTour'
import type { StatusId } from '../../core/workflow'
import type { PublicPrintRequest } from '../../core/types'
import { LazyThumb } from './LazyThumb'
import { FitAlertIcon } from './PrintType'
import { printTypeLabel } from './PrintType'
import { TagDotCluster } from './TagBadge'
import { UserAvatar } from './UserAvatar'
import { PrintEstimateBadges } from './PrintEstimate'

export function RequestCard({
  request,
  reorderableRequestIds,
  status,
  count,
  canDrag,
  canDragTags,
  reorderEnabled,
  settling,
  showPrintType = false,
  showPrinter = false,
  showRequester = false,
  tagPaths,
  tagCopyCounts,
  annotation,
  selected = false,
  selectionMode = false,
  selectedRequestIds,
  groupId,
  ungrouped = false,
  onOpen,
  onSelect,
  onSelectTag,
  onMove,
  onDownload,
  onRepeat,
  onDelete,
  onManageTags,
}: {
  request: PublicPrintRequest
  reorderableRequestIds: Set<string>
  status: StatusId
  count: number
  canDrag: boolean
  canDragTags: boolean
  reorderEnabled: boolean
  settling: boolean
  showPrintType?: boolean
  showPrinter?: boolean
  showRequester?: boolean
  /** Full paths keyed by tag id. Supplying it is what makes the card show its tags. */
  tagPaths?: Map<string, string>
  tagCopyCounts?: Map<string, number>
  annotation?: string
  selected?: boolean
  selectionMode?: boolean
  selectedRequestIds?: string[]
  groupId?: string
  ungrouped?: boolean
  onOpen: () => void
  onSelect?: (options: { range: boolean; toggle: boolean }) => void
  onSelectTag?: (tagId: string) => void
  onMove?: () => void
  onDownload?: () => void
  onRepeat?: () => void
  onDelete?: () => void
  onManageTags?: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const draggedTagRef = useRef<{ id: string; count: number } | undefined>(undefined)
  const [dragging, setDragging] = useState(false)
  const [draggingTagId, setDraggingTagId] = useState<string>()
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null)
  const tags = tagPaths ? request.groups.filter((group) => group.status === status) : []
  const tagSummaries = tags.map((tag) => ({
    id: tag.id,
    color: tag.color,
    path: tagPaths?.get(tag.id) ?? tag.name,
    count: tagCopyCounts?.get(`${status}:${tag.id}`) ?? tag.count,
  }))

  useEffect(() => {
    const element = ref.current
    if (!element || !canDrag) return
    return combine(
      draggable({
        element,
        getInitialData: ({ input }) => {
          const tag = draggedTagRef.current
          if (tag) {
            return {
              type: 'print-group',
              groupId: tag.id,
              from: status,
              count: tag.count,
            }
          }
          return {
            requestId: request.id,
            requesterId: request.requesterId,
            from: status,
            count,
            groupId,
            ungrouped,
            selectedRequestIds,
            splitStack: input.altKey,
          }
        },
        onDragStart: ({ source }) => {
          setDragging(source.data.type !== 'print-group')
          setDraggingTagId(source.data.type === 'print-group' && typeof source.data.groupId === 'string' ? source.data.groupId : undefined)
        },
        onDrop: () => {
          draggedTagRef.current = undefined
          setDragging(false)
          setDraggingTagId(undefined)
        },
      }),
      dropTargetForElements({
        element,
        getData: ({ input, element: el }) =>
          attachClosestEdge(
            { type: 'card', requestId: request.id, requesterId: request.requesterId, status, groupId },
            { input, element: el, allowedEdges: ['top', 'bottom'] },
          ),
        getDropEffect: ({ input }) => boardDropEffect(input),
        onDrag: ({ self, source }) => {
          const sourceRequestId = source.data.requestId
          const sourceCanReorder = typeof sourceRequestId === 'string' && reorderableRequestIds.has(sourceRequestId)
          const groupMove = Array.isArray(source.data.selectedRequestIds) && source.data.selectedRequestIds.length > 1
          const sameGroup = typeof groupId === 'string' && source.data.groupId === groupId
          if (
            !groupMove &&
            canShowRequestDropEdge(source.data.from, status, reorderEnabled && sourceCanReorder) &&
            (sameGroup ||
              canDropOnRequest(
                source.data,
                { requesterId: request.requesterId, requestId: request.id, status },
                reorderEnabled && sourceCanReorder,
              ))
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
  }, [
    groupId,
    canDrag,
    canDragTags,
    ungrouped,
    count,
    reorderableRequestIds,
    reorderEnabled,
    request.id,
    request.requesterId,
    selectedRequestIds,
    status,
  ])

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    const tagId = (event.target as Element).closest<HTMLElement>('[data-tag-id]')?.dataset.tagId
    if (tagId && onSelectTag) {
      onSelectTag(tagId)
      return
    }
    if (selectionMode || event.shiftKey || event.metaKey || event.ctrlKey) {
      onSelect?.({ range: event.shiftKey, toggle: selectionMode || event.metaKey || event.ctrlKey })
      return
    }
    signalProductTourProgress('inspect')
    onOpen()
  }

  const card = (
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
      data-onboarding="request-card"
      data-edge={closestEdge ?? undefined}
      data-request-id={request.id}
      data-request-name={request.name}
      onPointerDownCapture={(event) => {
        const tag = canDragTags ? (event.target as Element).closest<HTMLElement>('[data-tag-id]') : null
        draggedTagRef.current = tag?.dataset.tagId ? { id: tag.dataset.tagId, count: Number(tag.dataset.tagCopyCount) } : undefined
      }}
      onPointerUpCapture={() => {
        draggedTagRef.current = undefined
      }}
      onClick={handleClick}
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
          {showRequester && (
            <Tooltip>
              <TooltipTrigger
                render={<span className="ph-no-capture ml-auto rounded-full" aria-label={`Requested by ${requesterLabel(request)}`} />}
              >
                <UserAvatar name={requesterLabel(request)} image={request.requesterImage} size="sm" />
              </TooltipTrigger>
              <TooltipContent className="ph-no-capture">Requested by {requesterLabel(request)}</TooltipContent>
            </Tooltip>
          )}
          <span className={cn('shrink-0 font-mono', !showRequester && 'ml-auto')}>
            {count === request.quantity ? `×${count}` : `×${count} of ${request.quantity}`}
          </span>
        </div>
        {annotation && <div className="mt-1 text-xs font-medium text-primary">{annotation}</div>}
        <div className="mt-1 truncate">
          <PrintEstimateBadges request={request} />
        </div>
      </div>
      <TagDotCluster tags={tagSummaries} draggable={canDragTags} activeTagId={draggingTagId} />
    </Button>
  )

  return (
    <div className="relative">
      {onSelect || onMove || onDownload || onRepeat || onDelete || onManageTags ? (
        <ContextMenu>
          <ContextMenuTrigger className="block">{card}</ContextMenuTrigger>
          <ContextMenuContent>
            {onSelect && (
              <ContextMenuItem
                onClick={() => {
                  onSelect({ range: false, toggle: true })
                  signalProductTourProgress('actions')
                }}
              >
                <Check />
                {selectionMode ? (selected ? 'Remove from selection' : 'Add to selection') : 'Select'}
              </ContextMenuItem>
            )}
            {onManageTags && (
              <ContextMenuItem onClick={onManageTags}>
                <Layers3 />
                Manage tags
              </ContextMenuItem>
            )}
            {onDownload && (
              <ContextMenuItem onClick={onDownload}>
                <Download />
                Download STL{selectedRequestIds && selectedRequestIds.length > 1 ? 's' : ''}
              </ContextMenuItem>
            )}
            {onRepeat && (
              <ContextMenuItem onClick={onRepeat}>
                <RotateCcw />
                Print again…
              </ContextMenuItem>
            )}
            {onMove && (
              <ContextMenuItem onClick={onMove}>
                <Move />
                Move
              </ContextMenuItem>
            )}
            {onDelete && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" onClick={onDelete}>
                  <Trash2 />
                  Delete
                </ContextMenuItem>
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        card
      )}
    </div>
  )
}
