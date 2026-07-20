import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { StatusId, WorkflowStatus } from '../../core/workflow'
import type { PublicPrintRequest } from '../../core/types'
import { cn } from '@/lib/utils'
import { Card, CardHeader } from '@/components/ui/card'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { canDropOnColumn } from '../boardDrag'
import { RequestCard } from './RequestCard'

export function Column({
  status,
  definition,
  entries,
  isAdmin,
  reorderEnabled,
  showPrintType,
  filtered,
  settlingIds,
  onOpenRequest,
}: {
  status: StatusId
  definition: WorkflowStatus
  entries: { request: PublicPrintRequest; count: number }[]
  isAdmin: boolean
  reorderEnabled: boolean
  showPrintType: boolean
  filtered: boolean
  settlingIds: Set<string>
  onOpenRequest: (requestId: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [isOver, setIsOver] = useState(false)

  useEffect(() => {
    const element = ref.current
    const scrollElement = bodyRef.current
    // Columns as drop targets are for cross-status moves — admin only.
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
              canDrop: ({ source }) => canDropOnColumn(source.data.from, status),
              getData: () => ({ type: 'column', status }),
              onDragEnter: () => setIsOver(true),
              onDragLeave: () => setIsOver(false),
              onDrop: () => setIsOver(false),
            }),
          ]
        : []),
    )
  }, [isAdmin, status])

  const total = entries.reduce((sum, entry) => sum + entry.count, 0)
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
    <Card ref={ref} className={cn('column min-w-[240px] gap-0 py-0 ring-1 ring-border', isOver && 'ring-primary')} data-status={status}>
      <CardHeader className="flex grid-cols-none flex-row items-center gap-2 rounded-none border-b px-3 py-2.5 font-heading text-xs font-semibold tracking-[0.04em] uppercase">
        <span
          className={cn(
            'size-2 rounded-full bg-muted-foreground',
            status === 'todo' && 'bg-sky-400',
            status === 'up_next' && 'bg-violet-400',
            status === 'in_progress' && 'bg-primary',
            status === 'post_processing' && 'bg-cyan-400',
            status === 'done' && 'bg-[var(--chart-2)]',
          )}
        />
        {definition.label}
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground" title="Copies">
          {total}
        </span>
      </CardHeader>
      <div ref={bodyRef} className="column-body virtualized relative flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-2.5">
        {entries.length === 0 && (
          <Empty className="border-0 py-6">
            <EmptyDescription>{filtered ? 'No matching prints in this stage.' : definition.empty}</EmptyDescription>
          </Empty>
        )}
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
                  showPrintType={showPrintType}
                  showPrinter={isAdmin}
                  showRequester={isAdmin}
                  onOpen={() => onOpenRequest(request.id)}
                />
              </VirtualRow>
            )
          })}
        </div>
      </div>
    </Card>
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
