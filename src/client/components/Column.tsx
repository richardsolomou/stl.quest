import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { StatusId, WorkflowStatus } from '../../core/workflow'
import type { PrintGroup, PublicPrintRequest } from '../../core/types'
import { cn } from '@/lib/utils'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { canDropOnColumn } from '../boardDrag'
import { RequestCard } from './RequestCard'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { ChevronDown, Pencil, Trash2 } from 'lucide-react'

const groupColorClasses: Record<PrintGroup['color'], { section: string; active: string; header: string; empty: string }> = {
  blue: {
    section: 'border-blue-500/40 bg-blue-500/8',
    active: 'border-blue-500 bg-blue-500/15',
    header: 'hover:bg-blue-500/10',
    empty: 'border-blue-500/40',
  },
  green: {
    section: 'border-emerald-500/40 bg-emerald-500/8',
    active: 'border-emerald-500 bg-emerald-500/15',
    header: 'hover:bg-emerald-500/10',
    empty: 'border-emerald-500/40',
  },
  amber: {
    section: 'border-amber-500/40 bg-amber-500/8',
    active: 'border-amber-500 bg-amber-500/15',
    header: 'hover:bg-amber-500/10',
    empty: 'border-amber-500/40',
  },
  violet: {
    section: 'border-violet-500/40 bg-violet-500/8',
    active: 'border-violet-500 bg-violet-500/15',
    header: 'hover:bg-violet-500/10',
    empty: 'border-violet-500/40',
  },
  rose: {
    section: 'border-rose-500/40 bg-rose-500/8',
    active: 'border-rose-500 bg-rose-500/15',
    header: 'hover:bg-rose-500/10',
    empty: 'border-rose-500/40',
  },
  cyan: {
    section: 'border-cyan-500/40 bg-cyan-500/8',
    active: 'border-cyan-500 bg-cyan-500/15',
    header: 'hover:bg-cyan-500/10',
    empty: 'border-cyan-500/40',
  },
  orange: {
    section: 'border-orange-500/40 bg-orange-500/8',
    active: 'border-orange-500 bg-orange-500/15',
    header: 'hover:bg-orange-500/10',
    empty: 'border-orange-500/40',
  },
  lime: {
    section: 'border-lime-500/40 bg-lime-500/8',
    active: 'border-lime-500 bg-lime-500/15',
    header: 'hover:bg-lime-500/10',
    empty: 'border-lime-500/40',
  },
  fuchsia: {
    section: 'border-fuchsia-500/40 bg-fuchsia-500/8',
    active: 'border-fuchsia-500 bg-fuchsia-500/15',
    header: 'hover:bg-fuchsia-500/10',
    empty: 'border-fuchsia-500/40',
  },
  sky: {
    section: 'border-sky-500/40 bg-sky-500/8',
    active: 'border-sky-500 bg-sky-500/15',
    header: 'hover:bg-sky-500/10',
    empty: 'border-sky-500/40',
  },
  teal: {
    section: 'border-teal-500/40 bg-teal-500/8',
    active: 'border-teal-500 bg-teal-500/15',
    header: 'hover:bg-teal-500/10',
    empty: 'border-teal-500/40',
  },
  indigo: {
    section: 'border-indigo-500/40 bg-indigo-500/8',
    active: 'border-indigo-500 bg-indigo-500/15',
    header: 'hover:bg-indigo-500/10',
    empty: 'border-indigo-500/40',
  },
}

export function Column({
  status,
  definition,
  entries,
  groups,
  isAdmin,
  showRequesters,
  reorderEnabled,
  showPrintType,
  filtered,
  settlingIds,
  selectionStatus,
  selectedIds,
  onOpenRequest,
  onCreateGroup,
  onSelectRequest,
  onMoveRequest,
  onDeleteRequest,
  onRenameGroup,
  onDeleteGroup,
}: {
  status: StatusId
  definition: WorkflowStatus
  entries: { request: PublicPrintRequest; count: number }[]
  groups: { group: PrintGroup; items: { request: PublicPrintRequest; count: number }[] }[]
  isAdmin: boolean
  showRequesters: boolean
  reorderEnabled: boolean
  showPrintType: boolean
  filtered: boolean
  settlingIds: Set<string>
  selectionStatus?: StatusId
  selectedIds: Set<string>
  onOpenRequest: (requestId: string) => void
  onCreateGroup: (requestId: string, status: StatusId, count: number) => void
  onSelectRequest: (status: StatusId, requestId: string, orderedIds: string[], options: { range: boolean; toggle: boolean }) => void
  onMoveRequest?: (requestId: string, status: StatusId, count: number) => void
  onDeleteRequest?: (requestId: string, status: StatusId, count: number) => void
  onRenameGroup: (group: PrintGroup) => void
  onDeleteGroup: (group: PrintGroup) => void
}) {
  const laneRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [isOver, setIsOver] = useState(false)
  const [groupItemDragging, setGroupItemDragging] = useState(false)

  useEffect(
    () =>
      monitorForElements({
        onDragStart: ({ source }) =>
          setGroupItemDragging(
            source.data.from === status && typeof source.data.requestId === 'string' && typeof source.data.groupId === 'string',
          ),
        onDrop: () => setGroupItemDragging(false),
      }),
    [status],
  )

  useEffect(() => {
    const element = laneRef.current
    const scrollElement = bodyRef.current
    // The lane is the drop target for cross-status moves — admin only — kept separate from the
    // scrollable body so it doesn't share a DOM node with the auto-scroll/virtualizer bindings.
    if (!element || !scrollElement) return
    return combine(
      autoScrollForElements({
        element: scrollElement,
        getAllowedAxis: () => 'vertical',
        getConfiguration: () => ({ maxScrollSpeed: 'fast' }),
      }),
      ...(isAdmin
        ? [
            dropTargetForElements({
              element,
              canDrop: ({ source }) =>
                (typeof source.data.groupId === 'string' && source.data.from === status) || canDropOnColumn(source.data.from, status),
              getData: () => ({ type: 'column', status }),
              onDragEnter: () => setIsOver(true),
              onDragLeave: () => setIsOver(false),
              onDrop: () => setIsOver(false),
            }),
          ]
        : []),
    )
  }, [isAdmin, status])

  const reorderableRequestIds = useMemo(
    () => new Set(entries.filter(({ request }) => request.mine).map(({ request }) => request.id)),
    [entries],
  )
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => bodyRef.current,
    estimateSize: () => 86,
    overscan: 12,
  })

  return (
    <div ref={laneRef} className="column-lane flex min-h-0 flex-col" data-status={status}>
      <div
        ref={bodyRef}
        className={cn(
          'column-body virtualized relative flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto rounded-md px-1 py-2.5 transition-colors',
          (isOver || groupItemDragging) && 'bg-blueprint/[0.06] outline-dashed outline-2 outline-offset-4 outline-blueprint/50',
        )}
      >
        {entries.length === 0 && groups.length === 0 && (
          <Empty className="border-0 py-6">
            <EmptyDescription>{filtered ? 'No matching prints in this stage.' : definition.empty}</EmptyDescription>
          </Empty>
        )}
        {groups.map(({ group, items }) => (
          <GroupSection
            key={group.id}
            group={group}
            items={items}
            status={status}
            isAdmin={isAdmin}
            showPrintType={showPrintType}
            onOpenRequest={onOpenRequest}
            onRenameGroup={onRenameGroup}
            onDeleteGroup={onDeleteGroup}
          />
        ))}
        <div className="virtual-list relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const { request, count } = entries[item.index]
            return (
              <VirtualRow key={request.id} index={item.index} start={item.start} measureElement={virtualizer.measureElement}>
                <RequestCard
                  request={request}
                  reorderableRequestIds={reorderableRequestIds}
                  status={status}
                  count={count}
                  canDrag={isAdmin || (reorderEnabled && request.mine)}
                  reorderEnabled={reorderEnabled}
                  settling={settlingIds.has(request.id)}
                  selected={selectionStatus === status && selectedIds.has(request.id)}
                  selectionMode={selectionStatus !== undefined}
                  selectedRequestIds={selectionStatus === status && selectedIds.has(request.id) ? [...selectedIds] : undefined}
                  showPrintType={showPrintType}
                  showPrinter={isAdmin}
                  showRequester={showRequesters}
                  onOpen={() => onOpenRequest(request.id)}
                  onMove={onMoveRequest ? () => onMoveRequest(request.id, status, count) : undefined}
                  onDelete={onDeleteRequest ? () => onDeleteRequest(request.id, status, count) : undefined}
                  onCreateGroup={isAdmin ? () => onCreateGroup(request.id, status, count) : undefined}
                  onSelect={(options) =>
                    onSelectRequest(
                      status,
                      request.id,
                      entries.map((entry) => entry.request.id),
                      options,
                    )
                  }
                />
              </VirtualRow>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function GroupSection({
  group,
  items,
  status,
  isAdmin,
  showPrintType,
  onOpenRequest,
  onRenameGroup,
  onDeleteGroup,
}: {
  group: PrintGroup
  items: { request: PublicPrintRequest; count: number }[]
  status: StatusId
  isAdmin: boolean
  showPrintType: boolean
  onOpenRequest: (requestId: string) => void
  onRenameGroup: (group: PrintGroup) => void
  onDeleteGroup: (group: PrintGroup) => void
}) {
  const ref = useRef<HTMLElement>(null)
  const [isOver, setIsOver] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const colors = groupColorClasses[group.color]
  const printCount = items.reduce((sum, item) => sum + item.count, 0)
  const reorderableRequestIds = useMemo(() => new Set(items.map((item) => item.request.id)), [items])

  useEffect(() => {
    setCollapsed(localStorage.getItem(`stlquest:print-group:${group.id}:collapsed`) === 'true')
  }, [group.id])

  useEffect(() => {
    const element = ref.current
    if (!element || !isAdmin) return
    return combine(
      dropTargetForElements({
        element,
        canDrop: ({ source }) => typeof source.data.requestId === 'string',
        getData: () => ({ type: 'group', groupId: group.id, status }),
        onDragEnter: () => setIsOver(true),
        onDragLeave: () => setIsOver(false),
        onDrop: () => setIsOver(false),
      }),
      draggable({
        element,
        getInitialData: () => ({ type: 'print-group', groupId: group.id, from: status }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
      }),
    )
  }, [group.id, isAdmin, status])

  const section = (
    <section
      ref={ref}
      className={cn(
        'rounded-lg border-2 p-2 transition-[border-color,background-color,opacity,transform]',
        colors.section,
        isOver && colors.active,
        dragging && 'scale-[0.985] opacity-40',
      )}
      aria-label={`Group ${group.name}`}
      data-group-color={group.color}
    >
      <div
        className={cn('flex items-center gap-2 rounded px-1 py-1', !collapsed && 'mb-2', isAdmin && 'cursor-grab', colors.header)}
        title={isAdmin ? 'Drag group to another stage' : undefined}
        data-group-drag-handle={isAdmin || undefined}
      >
        {isAdmin && (
          <span className="text-sm tracking-[-0.2em] text-muted-foreground" aria-hidden="true">
            ⠿
          </span>
        )}
        <h3 className="min-w-0 flex-1 truncate font-heading text-xs font-semibold tracking-wide uppercase">{group.name}</h3>
        <span className="font-mono text-[10px] text-muted-foreground">
          {printCount} {printCount === 1 ? 'print' : 'prints'}
        </span>
        <button
          type="button"
          className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${group.name}`}
          aria-expanded={!collapsed}
          onClick={(event) => {
            event.stopPropagation()
            const next = !collapsed
            setCollapsed(next)
            localStorage.setItem(`stlquest:print-group:${group.id}:collapsed`, String(next))
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <ChevronDown className={cn('size-4 transition-transform', collapsed && '-rotate-90')} />
        </button>
      </div>
      {!collapsed && items.length === 0 ? (
        <div className={cn('rounded-md border border-dashed px-3 py-5 text-center text-xs text-muted-foreground', colors.empty)}>
          Drag prints here
        </div>
      ) : !collapsed ? (
        <div className="space-y-2">
          {items.map(({ request, count }) => (
            <RequestCard
              key={request.id}
              request={request}
              reorderableRequestIds={reorderableRequestIds}
              status={status}
              count={count}
              groupId={group.id}
              canDrag={isAdmin}
              reorderEnabled={isAdmin}
              settling={false}
              showPrintType={showPrintType}
              showPrinter={isAdmin}
              showRequester={isAdmin}
              onOpen={() => onOpenRequest(request.id)}
            />
          ))}
        </div>
      ) : null}
    </section>
  )

  return isAdmin ? (
    <ContextMenu>
      <ContextMenuTrigger className="block">{section}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onRenameGroup(group)}>
          <Pencil />
          Rename
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => onDeleteGroup(group)}>
          <Trash2 />
          Delete group
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ) : (
    section
  )
}

function VirtualRow({
  index,
  start,
  measureElement,
  children,
}: {
  index: number
  start: number
  measureElement: (element: HTMLDivElement | null) => void
  children: ReactNode
}) {
  const [transitionsEnabled, setTransitionsEnabled] = useState(false)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setTransitionsEnabled(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  return (
    <div
      className={cn(
        'virtual-row absolute top-0 left-0 w-full pb-2 will-change-transform has-[.dragging]:z-2 has-[.dragging]:transition-none',
        transitionsEnabled && 'transition-[transform,opacity] duration-200 ease-out',
      )}
      data-index={index}
      ref={measureElement}
      style={{ transform: `translateY(${start}px)` }}
    >
      {children}
    </div>
  )
}
