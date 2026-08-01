import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { StatusId, WorkflowStatus } from '../../core/workflow'
import type { PrintGroup, PublicPrintRequest } from '../../core/types'
import { cn } from '@/lib/utils'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { boardDropEffect, canDropOnColumn } from '../boardDrag'
import { RequestCard } from './RequestCard'
import { PrintGroupSection } from './PrintGroupSection'

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
  selectionMode,
  selectedIds,
  selectedGroupIds,
  onOpenRequest,
  onCreateGroup,
  onSelectRequest,
  onMoveSelection,
  onDownloadSelection,
  onDeleteSelection,
  onMoveRequest,
  onDownloadRequest,
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
  selectionMode: boolean
  selectedIds: Set<string>
  selectedGroupIds: Map<string, string>
  onOpenRequest: (requestId: string) => void
  onCreateGroup?: (requestId: string, status: StatusId, count: number) => void
  onSelectRequest: (
    status: StatusId,
    requestId: string,
    orderedIds: string[],
    options: { range: boolean; toggle: boolean },
    groupId?: string,
  ) => void
  onMoveRequest?: (requestId: string, status: StatusId, count: number) => void
  onDownloadRequest?: (requestId: string, status: StatusId) => void
  onDeleteRequest?: (requestId: string, status: StatusId, count: number) => void
  onMoveSelection: () => void
  onDownloadSelection: () => void
  onDeleteSelection: () => void
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
              getDropEffect: ({ input }) => boardDropEffect(input),
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
          <PrintGroupSection
            key={group.id}
            group={group}
            items={items}
            status={status}
            isAdmin={isAdmin}
            showPrintType={showPrintType}
            selectionMode={selectionMode}
            selectedIds={selectedIds}
            selectedGroupIds={selectedGroupIds}
            onOpenRequest={onOpenRequest}
            onSelectRequest={onSelectRequest}
            onMoveSelection={onMoveSelection}
            onDownloadSelection={onDownloadSelection}
            onDeleteSelection={onDeleteSelection}
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
                  selected={selectedIds.has(request.id)}
                  selectionMode={selectionMode}
                  selectedRequestIds={selectedIds.has(request.id) ? [...selectedIds] : undefined}
                  showPrintType={showPrintType}
                  showPrinter={isAdmin}
                  showRequester={showRequesters}
                  onOpen={() => onOpenRequest(request.id)}
                  onMove={onMoveRequest ? () => onMoveRequest(request.id, status, count) : undefined}
                  onDownload={onDownloadRequest ? () => onDownloadRequest(request.id, status) : undefined}
                  onDelete={onDeleteRequest ? () => onDeleteRequest(request.id, status, count) : undefined}
                  onCreateGroup={isAdmin && onCreateGroup ? () => onCreateGroup(request.id, status, count) : undefined}
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
