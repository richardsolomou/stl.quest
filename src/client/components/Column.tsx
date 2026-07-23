import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { StatusId, WorkflowStatus } from '../../core/workflow'
import type { PrintBatch, PublicPrintRequest } from '../../core/types'
import { cn } from '@/lib/utils'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { canDropOnColumn } from '../boardDrag'
import { RequestCard } from './RequestCard'
import { Button } from '@/components/ui/button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu'

export function Column({
  status,
  definition,
  entries,
  batches,
  batchDestinations,
  isAdmin,
  reorderEnabled,
  showPrintType,
  filtered,
  settlingIds,
  selectionStatus,
  selectedIds,
  onOpenRequest,
  onMoveBatch,
  onSelectRequest,
}: {
  status: StatusId
  definition: WorkflowStatus
  entries: { request: PublicPrintRequest; count: number }[]
  batches: { batch: PrintBatch; items: { request: PublicPrintRequest; count: number }[] }[]
  batchDestinations: { id: StatusId; label: string }[]
  isAdmin: boolean
  reorderEnabled: boolean
  showPrintType: boolean
  filtered: boolean
  settlingIds: Set<string>
  selectionStatus?: StatusId
  selectedIds: Set<string>
  onOpenRequest: (requestId: string) => void
  onMoveBatch: (batchId: string, to: StatusId) => void
  onSelectRequest: (status: StatusId, requestId: string, orderedIds: string[], options: { range: boolean; toggle: boolean }) => void
}) {
  const laneRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [isOver, setIsOver] = useState(false)

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
          isOver && 'bg-blueprint/[0.06] outline-dashed outline-2 outline-offset-4 outline-blueprint/50',
        )}
      >
        {entries.length === 0 && batches.length === 0 && (
          <Empty className="border-0 py-6">
            <EmptyDescription>{filtered ? 'No matching prints in this stage.' : definition.empty}</EmptyDescription>
          </Empty>
        )}
        {batches.map(({ batch, items }) => (
          <section key={batch.id} className="rounded-lg border-2 border-primary/35 bg-primary/5 p-2" aria-label={`Batch ${batch.name}`}>
            <div className="mb-2 flex items-center gap-2 px-1">
              <h3 className="min-w-0 flex-1 truncate font-heading text-xs font-semibold tracking-wide uppercase">{batch.name}</h3>
              <span className="font-mono text-[10px] text-muted-foreground">{items.reduce((sum, item) => sum + item.count, 0)} copies</span>
              {isAdmin && (
                <Menu>
                  <MenuTrigger render={<Button size="xs" variant="outline" />}>Move batch</MenuTrigger>
                  <MenuContent align="end">
                    {batchDestinations.map((destination) => (
                      <MenuItem key={destination.id} onClick={() => onMoveBatch(batch.id, destination.id)}>
                        {destination.label}
                      </MenuItem>
                    ))}
                  </MenuContent>
                </Menu>
              )}
            </div>
            <div className="space-y-2">
              {items.map(({ request, count }) => (
                <RequestCard
                  key={request.id}
                  request={request}
                  reorderableRequestIds={new Set()}
                  status={status}
                  count={count}
                  canDrag={false}
                  reorderEnabled={false}
                  settling={false}
                  showPrintType={showPrintType}
                  showPrinter={isAdmin}
                  showRequester={isAdmin}
                  onOpen={() => onOpenRequest(request.id)}
                />
              ))}
            </div>
          </section>
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
                  showRequester={isAdmin}
                  onOpen={() => onOpenRequest(request.id)}
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
