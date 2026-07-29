import { useEffect, useMemo, useRef, useState } from 'react'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { ChevronDown, Pencil, Trash2 } from 'lucide-react'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import type { PrintGroup, PublicPrintRequest } from '../../core/types'
import type { StatusId } from '../../core/workflow'
import { RequestCard } from './RequestCard'

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

export function PrintGroupSection({
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
