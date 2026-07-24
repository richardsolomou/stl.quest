import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { StatusId, WorkflowStatus } from '../../core/workflow'
import type { PrintBatch, PublicPrintRequest } from '../../core/types'
import { cn } from '@/lib/utils'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { canDropOnColumn } from '../boardDrag'
import { RequestCard } from './RequestCard'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'

export function Column({
  status,
  definition,
  entries,
  batches,
  isAdmin,
  showRequesters,
  reorderEnabled,
  showPrintType,
  filtered,
  settlingIds,
  selectionStatus,
  selectedIds,
  onOpenRequest,
  onCreateBatch,
  onSelectRequest,
  onMoveRequest,
  onDeleteRequest,
  onRenameBatch,
  onDeleteBatch,
}: {
  status: StatusId
  definition: WorkflowStatus
  entries: { request: PublicPrintRequest; count: number }[]
  batches: { batch: PrintBatch; items: { request: PublicPrintRequest; count: number }[] }[]
  isAdmin: boolean
  showRequesters: boolean
  reorderEnabled: boolean
  showPrintType: boolean
  filtered: boolean
  settlingIds: Set<string>
  selectionStatus?: StatusId
  selectedIds: Set<string>
  onOpenRequest: (requestId: string) => void
  onCreateBatch: (requestId: string, status: StatusId, count: number) => void
  onSelectRequest: (status: StatusId, requestId: string, orderedIds: string[], options: { range: boolean; toggle: boolean }) => void
  onMoveRequest?: (requestId: string, status: StatusId, count: number) => void
  onDeleteRequest?: (requestId: string, status: StatusId, count: number) => void
  onRenameBatch: (batch: PrintBatch) => void
  onDeleteBatch: (batch: PrintBatch) => void
}) {
  const laneRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [isOver, setIsOver] = useState(false)
  const [batchItemDragging, setBatchItemDragging] = useState(false)

  useEffect(
    () =>
      monitorForElements({
        onDragStart: ({ source }) =>
          setBatchItemDragging(
            source.data.from === status && typeof source.data.requestId === 'string' && typeof source.data.batchId === 'string',
          ),
        onDrop: () => setBatchItemDragging(false),
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
                (typeof source.data.batchId === 'string' && source.data.from === status) || canDropOnColumn(source.data.from, status),
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
          (isOver || batchItemDragging) && 'bg-blueprint/[0.06] outline-dashed outline-2 outline-offset-4 outline-blueprint/50',
        )}
      >
        {entries.length === 0 && batches.length === 0 && (
          <Empty className="border-0 py-6">
            <EmptyDescription>{filtered ? 'No matching prints in this stage.' : definition.empty}</EmptyDescription>
          </Empty>
        )}
        {batches.map(({ batch, items }) => (
          <BatchSection
            key={batch.id}
            batch={batch}
            items={items}
            status={status}
            isAdmin={isAdmin}
            showPrintType={showPrintType}
            onOpenRequest={onOpenRequest}
            onRenameBatch={onRenameBatch}
            onDeleteBatch={onDeleteBatch}
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
                  onCreateBatch={isAdmin && status === 'todo' ? () => onCreateBatch(request.id, status, count) : undefined}
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

function BatchSection({
  batch,
  items,
  status,
  isAdmin,
  showPrintType,
  onOpenRequest,
  onRenameBatch,
  onDeleteBatch,
}: {
  batch: PrintBatch
  items: { request: PublicPrintRequest; count: number }[]
  status: StatusId
  isAdmin: boolean
  showPrintType: boolean
  onOpenRequest: (requestId: string) => void
  onRenameBatch: (batch: PrintBatch) => void
  onDeleteBatch: (batch: PrintBatch) => void
}) {
  const ref = useRef<HTMLElement>(null)
  const [isOver, setIsOver] = useState(false)
  const [dragging, setDragging] = useState(false)
  const printCount = items.reduce((sum, item) => sum + item.count, 0)

  useEffect(() => {
    const element = ref.current
    if (!element || !isAdmin) return
    return combine(
      dropTargetForElements({
        element,
        canDrop: ({ source }) => typeof source.data.requestId === 'string',
        getData: () => ({ type: 'batch', batchId: batch.id, status }),
        onDragEnter: () => setIsOver(true),
        onDragLeave: () => setIsOver(false),
        onDrop: () => setIsOver(false),
      }),
      draggable({
        element,
        getInitialData: () => ({ type: 'print-batch', batchId: batch.id, from: status }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
      }),
    )
  }, [batch.id, isAdmin, status])

  const section = (
    <section
      ref={ref}
      className={cn(
        'rounded-lg border-2 border-primary/35 bg-primary/5 p-2 transition-[border-color,background-color,opacity,transform]',
        isOver && 'border-primary bg-primary/15',
        dragging && 'scale-[0.985] opacity-40',
      )}
      aria-label={`Batch ${batch.name}`}
    >
      <div
        className={cn('mb-2 flex items-center gap-2 rounded px-1 py-1', isAdmin && 'cursor-grab hover:bg-primary/10')}
        title={isAdmin ? 'Drag batch to another stage' : undefined}
        data-batch-drag-handle={isAdmin || undefined}
      >
        {isAdmin && (
          <span className="text-sm tracking-[-0.2em] text-muted-foreground" aria-hidden="true">
            ⠿
          </span>
        )}
        <h3 className="min-w-0 flex-1 truncate font-heading text-xs font-semibold tracking-wide uppercase">{batch.name}</h3>
        <span className="font-mono text-[10px] text-muted-foreground">
          {printCount} {printCount === 1 ? 'print' : 'prints'}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-primary/35 px-3 py-5 text-center text-xs text-muted-foreground">
          Drag prints here
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(({ request, count }) => (
            <RequestCard
              key={request.id}
              request={request}
              reorderableRequestIds={new Set()}
              status={status}
              count={count}
              batchId={batch.id}
              canDrag={isAdmin}
              reorderEnabled={false}
              settling={false}
              showPrintType={showPrintType}
              showPrinter={isAdmin}
              showRequester={isAdmin}
              onOpen={() => onOpenRequest(request.id)}
            />
          ))}
        </div>
      )}
    </section>
  )

  return isAdmin ? (
    <ContextMenu>
      <ContextMenuTrigger className="block">{section}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onRenameBatch(batch)}>Rename</ContextMenuItem>
        <ContextMenuItem variant="destructive" onClick={() => onDeleteBatch(batch)}>
          Delete batch
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
