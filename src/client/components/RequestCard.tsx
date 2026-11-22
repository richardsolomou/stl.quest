import { useEffect, useRef, useState, type ComponentProps, type MouseEvent } from 'react'
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/utils/combine'
import { attachClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/attach-closest-edge'
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/extract-closest-edge'
import type { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/types'
import { Button } from '@/components/ui/button'
import { Archive, ArrowRight, Check, ChevronDown, Copy, Download, Layers, Layers3, Move, RotateCcw, Trash2 } from 'lucide-react'
import { Menu, MenuContent, MenuGroup, MenuGroupLabel, MenuItem, MenuTrigger } from '@/components/ui/menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { boardDropEffect, canDropOnRequest, canShowRequestDropEdge, isTouchOriginatedDragStart } from '../boardDrag'
import { requesterLabel } from '../requester'
import { signalProductTourProgress } from '../productTour'
import type { StatusId } from '../../core/workflow'
import type { PublicPrintRequest } from '../../core/types'
import { FitAlertIcon } from './PrintType'
import { printTypeLabel } from './PrintType'
import { TagDotCluster } from './TagBadge'
import { UserAvatar } from './UserAvatar'
import { PrintEstimateBadges } from './PrintEstimate'
import { RequestThumb } from './RequestThumb'
import { CopyCells } from './CopyCells'
import { AgeStamp } from './AgeStamp'
import { useNow } from '../useNow'
import { isAgeHot } from '../../core/requestAge'
import { useI18n } from '../i18n'
import type { CardPlate } from '../boardPlates'

/**
 * How a card presents in its zone of the board: `row` in the queue's backlog list, `ticket` hanging on the up-next rail
 * (`lead` for the one that fires next), `job` on a printer station, and `slip` on the finishing and ready shelf.
 */
export type RequestCardVariant = 'row' | 'ticket' | 'lead' | 'job' | 'slip'

/** One destination the advance action offers, with a short mono state beside its name. */
export type AdvanceChoice = { id: string; label: string; detail: string; onChoose: () => void }

/** Moves a card's copies on to the next stage in one action, or offers a choice of where (such as which printer). */
export type CardAdvance = { label: string; onAdvance: () => void } | { label: string; menuLabel: string; choices: AdvanceChoice[] }

export function RequestCard({
  request,
  variant = 'row',
  counts,
  position,
  since,
  sinceLabel,
  advance,
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
  plate,
  selected = false,
  selectionMode = false,
  selectedRequestIds,
  groupId,
  copyDownloadCount,
  onOpen,
  onSelect,
  onSelectTag,
  onMove,
  onDownload,
  onRepeat,
  onDelete,
  onArchive,
  onManageTags,
}: {
  request: PublicPrintRequest
  variant?: RequestCardVariant
  /** The request's live copy counts across every stage, which the copy cells draw. */
  counts?: Record<string, number>
  /** The card's place on the up-next rail, counted from one. */
  position?: number
  /** When the copies on this card started waiting, for the age stamp. */
  since?: number
  sinceLabel?: (age: string) => string
  advance?: CardAdvance
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
  /** The plate the card's copies are on, or the one that failed before they came back to print again. */
  plate?: CardPlate
  selected?: boolean
  selectionMode?: boolean
  selectedRequestIds?: string[]
  groupId?: string
  /** Files a per-copy download holds; the option shows only when set. */
  copyDownloadCount?: number
  onOpen: () => void
  onSelect?: (options: { range: boolean; toggle: boolean }) => void
  onSelectTag?: (tagId: string) => void
  onMove?: () => void
  onDownload?: (perCopy: boolean) => void
  onRepeat?: () => void
  onDelete?: () => void
  onArchive?: () => void
  onManageTags?: () => void
}) {
  const { t } = useI18n()
  const ref = useRef<HTMLButtonElement>(null)
  const draggedTagRef = useRef<{ id: string; count: number } | undefined>(undefined)
  const [dragging, setDragging] = useState(false)
  const [draggingTagId, setDraggingTagId] = useState<string>()
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null)
  const tags = tagPaths ? request.groups.filter((group) => group.status === status) : []
  const cardTagIds = request.groups
    .filter((group) => group.status === status)
    .map((group) => group.id)
    .join(',')
  const printType = request.printType ?? request.printer?.printType
  const tagSummaries = tags.map((tag) => ({
    id: tag.id,
    color: tag.color,
    path: tagPaths?.get(tag.id) ?? tag.name,
    count: tagCopyCounts?.get(`${status}:${tag.id}`) ?? tag.count,
  }))

  useEffect(() => {
    const element = ref.current
    if (!element || !canDrag) return
    const blockTouchNativeDrag = (event: DragEvent) => {
      if (isTouchOriginatedDragStart(event)) event.preventDefault()
    }
    element.addEventListener('dragstart', blockTouchNativeDrag)
    return combine(
      () => element.removeEventListener('dragstart', blockTouchNativeDrag),
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
            printType,
            from: status,
            count,
            groupId,
            tagIds: cardTagIds ? cardTagIds.split(',') : [],
            selected,
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
            { input, element: el, allowedEdges: variant === 'ticket' || variant === 'lead' ? ['left', 'right'] : ['top', 'bottom'] },
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
    cardTagIds,
    selected,
    count,
    printType,
    reorderableRequestIds,
    reorderEnabled,
    request.id,
    request.requesterId,
    selectedRequestIds,
    status,
    variant,
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

  const ticket = variant === 'ticket' || variant === 'lead'
  const requester = requesterLabel(request, t.requests.requesterFallback)
  const meta = [
    showPrintType && request.printType ? printTypeLabel(t, request.printType) : undefined,
    showPrinter && variant !== 'job' ? request.printer?.name : undefined,
  ].filter(Boolean)
  const countLabel = count === request.quantity ? `×${count}` : t.requests.card.partialCount(count, request.quantity)
  const age = since !== undefined && sinceLabel && <AgeStamp since={since} label={sinceLabel} />
  const avatar = showRequester && (
    <Tooltip>
      <TooltipTrigger render={<span className="ph-no-capture shrink-0" aria-label={t.requests.card.requestedBy(requester)} />}>
        <UserAvatar name={requester} image={request.requesterImage} size="sm" />
      </TooltipTrigger>
      <TooltipContent className="ph-no-capture">{t.requests.card.requestedBy(requester)}</TooltipContent>
    </Tooltip>
  )
  const notes = request.notes && (
    <p
      className={cn(
        'mt-1.5 line-clamp-2 font-medium break-words whitespace-pre-wrap text-note',
        variant === 'lead' ? 'text-sm' : 'text-xs',
      )}
    >
      {request.notes}
    </p>
  )
  const plateBadge = plate && (
    <span
      data-plate-badge={plate.number}
      title={plate.failed ? t.plates.failedHint(plate.number) : t.plates.sharedHint(plate.number)}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-[3px] border px-1 py-px font-mono text-[11px] leading-none font-semibold uppercase',
        plate.failed ? 'border-destructive/40 text-destructive' : 'border-current/30',
      )}
    >
      <Layers className="size-3" aria-hidden="true" />
      {plate.failed ? t.plates.failedBadge(plate.number) : t.plates.name(plate.number)}
    </span>
  )
  const cells = counts && <CopyCells counts={counts} status={status} stamp={settling} className="mt-1.5" />
  const now = useNow()
  // An overdue ticket carries the heat on its own header, not only in its age stamp.
  const hot = since !== undefined && now !== undefined && isAgeHot(now - since)

  const card = (
    <Button
      ref={ref}
      type="button"
      variant="outline"
      data-stage={status}
      className={cn(
        'card relative block h-auto w-full rounded-md border-2 border-transparent text-left whitespace-normal transition-[border-color,transform,opacity,box-shadow,background-color] duration-200',
        variant === 'row' && 'bg-transparent px-2 py-2 text-foreground shadow-none hover:bg-foreground/[0.05] hover:text-foreground',
        // The row's advance arrow appears on hover over its right edge, so that edge stays clear of the age and count.
        variant === 'row' && advance && 'pr-10',
        variant !== 'row' &&
          '[--note:var(--ticket-note)] bg-ticket text-ticket-foreground shadow-[0_1px_0_rgb(0_0_0/0.08),0_10px_18px_-12px_rgb(0_0_0/0.5)] hover:bg-ticket hover:text-ticket-foreground',
        ticket && 'rounded-[3px] px-3 pt-4 pb-3',
        variant === 'job' && 'p-2.5',
        variant === 'slip' && 'rounded-[3px] px-2.5 py-2',
        tagSummaries.length > 0 && 'pb-5',
        // The lead's button sits above its tag dots, so the lead keeps room for both.
        advance && variant === 'lead' && (tagSummaries.length > 0 ? 'pb-17' : 'pb-14'),
        advance && (variant === 'job' || variant === 'slip') && 'pr-12',
        canDrag && 'cursor-grab touch-manipulation',
        dragging && 'dragging scale-[0.985] opacity-40',
        settling && 'animate-[card-settle_320ms_cubic-bezier(0.16,1,0.3,1)]',
        selected && 'border-primary bg-primary/10 ring-4 ring-primary/20 hover:bg-primary/10',
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
            'pointer-events-none absolute z-10 rounded-full bg-(--stage)',
            closestEdge === 'top' && 'right-0 bottom-full left-0 h-1 -translate-y-[3px]',
            closestEdge === 'bottom' && 'top-full right-0 left-0 h-1 translate-y-[3px]',
            closestEdge === 'left' && 'top-0 right-full bottom-0 w-1 -translate-x-[5px]',
            closestEdge === 'right' && 'top-0 bottom-0 left-full w-1 translate-x-[5px]',
          )}
        />
      )}
      {ticket ? (
        <>
          <span
            aria-hidden="true"
            className={cn('absolute inset-x-0 top-0 rounded-t-[3px]', hot ? 'h-2.5 bg-note' : 'h-1.5 bg-(--stage)')}
          />
          <span
            aria-hidden="true"
            className="absolute -top-3 left-1/2 hidden h-4 w-8 -translate-x-1/2 rounded-[3px] border border-foreground/25 bg-rail @min-[960px]:block"
          />
          <span className="flex flex-col">
            {/* The thumbnail floats so the name flows around it, and a word too long to sit beside it drops below whole. The
                negative margin keeps the requester plate on the thumbnail's corner inside the clipped five-line block. */}
            <span
              className={cn(
                '-mr-1.5 mt-2 block max-h-[5lh] overflow-hidden pr-1.5 font-heading font-bold uppercase',
                variant === 'lead' ? 'text-[1.85rem]/[1]' : 'text-lg/[1.05]',
              )}
            >
              <span className={cn('relative float-right mb-1.5 ml-2', variant === 'lead' ? 'size-20' : 'size-14')}>
                <RequestThumb request={request} />
                {avatar && <span className="absolute -right-1.5 -bottom-1.5 flex rounded-[5px] ring-2 ring-ticket">{avatar}</span>}
              </span>
              {request.name}
            </span>
            <span className="-order-1 flex items-center gap-2 font-mono text-[11px] leading-none text-ticket-muted uppercase">
              {position !== undefined && <span>#{String(position).padStart(2, '0')}</span>}
              {variant === 'lead' && <span className="font-bold text-ticket-foreground">{t.board.pass.firesNext}</span>}
              <span className="ml-auto flex items-center gap-1.5">
                <FitAlertIcon request={request} />
                {age}
              </span>
            </span>
          </span>
          {notes}
          {cells}
          {plateBadge && <span className="mt-2 flex text-ticket-muted">{plateBadge}</span>}
          <span className="mt-2 flex items-start gap-2 border-t border-dashed border-ticket-foreground/20 pt-2 font-mono text-[11px] leading-tight text-ticket-muted uppercase">
            <span className="min-w-0 flex-1 break-words" title={showPrinter ? request.printer?.name : undefined}>
              {meta.join(' · ')}
            </span>
            <span className="shrink-0 text-ticket-foreground">{countLabel}</span>
          </span>
          {variant === 'lead' && <PrintEstimateBadges request={request} />}
        </>
      ) : (
        <span className={cn('flex items-start', variant === 'slip' || !avatar ? 'gap-2.5' : 'gap-4')}>
          <span
            className={cn(
              'relative shrink-0',
              variant === 'row' && 'size-14',
              variant === 'job' && 'size-16 max-[620px]:size-14',
              variant === 'slip' && 'size-12',
            )}
          >
            <RequestThumb request={request} />
            {variant !== 'slip' && avatar && (
              <span
                className={cn(
                  'absolute -right-2 -bottom-2 flex rounded-[5px] ring-2',
                  variant === 'row' ? 'ring-background' : 'ring-ticket',
                )}
              >
                {avatar}
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-start gap-1.5">
              <span
                className={cn(
                  'line-clamp-2 min-w-0 flex-1 font-serif leading-tight max-[620px]:line-clamp-3',
                  variant === 'job' ? 'text-base font-bold' : 'text-[0.9rem] font-semibold',
                )}
              >
                {request.name}
              </span>
              <FitAlertIcon request={request} />
              {age}
            </span>
            {variant !== 'slip' && (
              <span
                className={cn(
                  'mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-xs leading-4',
                  variant === 'row' ? 'text-muted-foreground' : 'text-ticket-muted',
                )}
              >
                {plateBadge}
                {meta.length > 0 && (
                  <span className="min-w-0 flex-1 truncate" title={showPrinter ? request.printer?.name : undefined}>
                    {meta.join(' · ')}
                  </span>
                )}
                <span className="ml-auto shrink-0 font-mono">{countLabel}</span>
              </span>
            )}
            {variant === 'slip' && (
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[11px] leading-none text-ticket-muted">
                {plateBadge}
                {countLabel}
              </span>
            )}
            {variant !== 'slip' && notes}
            {variant !== 'slip' && cells}
          </span>
        </span>
      )}
      <TagDotCluster tags={tagSummaries} draggable={canDragTags} activeTagId={draggingTagId} />
    </Button>
  )

  return (
    <div className="group/card relative">
      {onSelect || onMove || onDownload || onRepeat || onDelete || onArchive || onManageTags ? (
        <ContextMenu>
          <ContextMenuTrigger className="block">{card}</ContextMenuTrigger>
          <ContextMenuContent>
            {onSelect && (
              <ContextMenuItem onClick={() => onSelect({ range: false, toggle: true })}>
                <Check />
                {selectionMode
                  ? selected
                    ? t.requests.actions.removeFromSelection
                    : t.requests.actions.addToSelection
                  : t.requests.actions.select}
              </ContextMenuItem>
            )}
            {onManageTags && (
              <ContextMenuItem onClick={onManageTags}>
                <Layers3 />
                {t.requests.actions.manageTags}
              </ContextMenuItem>
            )}
            {onDownload && (
              <ContextMenuItem onClick={() => onDownload(false)}>
                <Download />
                {t.requests.actions.downloadModels(selectedRequestIds?.length ?? 1)}
              </ContextMenuItem>
            )}
            {onDownload && copyDownloadCount !== undefined && (
              <ContextMenuItem onClick={() => onDownload(true)}>
                <Copy />
                {selectedRequestIds && selectedRequestIds.length > 1
                  ? t.requests.actions.downloadAllCopies
                  : t.requests.actions.downloadCopies(copyDownloadCount)}
              </ContextMenuItem>
            )}
            {onRepeat && (
              <ContextMenuItem onClick={onRepeat}>
                <RotateCcw />
                {t.requests.actions.printAgain}
              </ContextMenuItem>
            )}
            {onMove && (
              <ContextMenuItem onClick={onMove}>
                <Move />
                {t.requests.actions.move}
              </ContextMenuItem>
            )}
            {onArchive && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={onArchive}>
                  <Archive />
                  {t.requests.actions.archive}
                </ContextMenuItem>
              </>
            )}
            {onDelete && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" onClick={onDelete}>
                  <Trash2 />
                  {t.common.delete}
                </ContextMenuItem>
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        card
      )}
      {advance && (
        <AdvanceButton
          advance={advance}
          size={variant === 'lead' ? 'sm' : 'icon-sm'}
          variant={variant === 'lead' ? 'default' : 'outline'}
          className={cn(
            'absolute z-1',
            // The lead grows its button to fit the printer it names, and truncates only past the ticket's width.
            variant === 'lead' && 'right-3 max-w-[calc(100%-1.5rem)]',
            variant === 'lead' && (tagSummaries.length > 0 ? 'bottom-6' : 'bottom-3'),
            (variant === 'job' || variant === 'slip') &&
              'top-1/2 right-2 -translate-y-1/2 border-ticket-foreground/25 bg-ticket text-ticket-foreground hover:bg-ticket-foreground/10 hover:text-ticket-foreground',
            variant === 'ticket' &&
              'right-2 bottom-2 border-ticket-foreground/25 bg-ticket text-ticket-foreground opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100 hover:bg-ticket-foreground/10 hover:text-ticket-foreground',
            variant === 'row' && 'top-1/2 right-1.5 -translate-y-1/2 opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100',
            'data-popup-open:opacity-100',
          )}
          aria-label={variant === 'lead' ? undefined : `${advance.label}: ${request.name}`}
          title={advance.label}
        >
          {variant === 'lead' && <span className="truncate">{advance.label}</span>}
          {'choices' in advance ? <ChevronDown /> : <ArrowRight />}
        </AdvanceButton>
      )}
    </div>
  )
}

/** The advance action as one button, or, when it offers a choice, as the trigger of a menu of destinations. */
function AdvanceButton({ advance, children, ...props }: Omit<ComponentProps<typeof Button>, 'onClick'> & { advance: CardAdvance }) {
  if (!('choices' in advance))
    return (
      <Button type="button" {...props} onClick={advance.onAdvance}>
        {children}
      </Button>
    )
  return (
    <Menu>
      <MenuTrigger render={<Button type="button" {...props} />}>{children}</MenuTrigger>
      <MenuContent align="end" className="w-64">
        <MenuGroup>
          <MenuGroupLabel>{advance.menuLabel}</MenuGroupLabel>
          {advance.choices.map((choice) => (
            <MenuItem key={choice.id} onClick={choice.onChoose}>
              <span className="min-w-0 truncate font-semibold">{choice.label}</span>
              <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground uppercase">{choice.detail}</span>
            </MenuItem>
          ))}
        </MenuGroup>
      </MenuContent>
    </Menu>
  )
}
