import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { StatusId, WorkflowStatus } from '../../core/workflow'
import type { PublicPrintRequest } from '../../core/types'
import { cn } from '@/lib/utils'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { boardCardKey, boardDropEffect, canDropOnColumn } from '../boardDrag'
import type { BoardRequestEntry } from '../boardEntries'
import { boardCohortId } from '../boardSelection'
import { RequestCard } from './RequestCard'

export function Column({
  status,
  definition,
  entries,
  tagPaths,
  tagCopyCounts,
  isAdmin,
  showRequesters,
  reorderEnabled,
  showPrintType,
  filtered,
  settlingCardKeys,
  selectionMode,
  selectedIds,
  selectedGroupIds,
  selectedRequestIds,
  canDeleteSelection,
  canRepeatSelection,
  onOpenRequest,
  onManageTags,
  onSelectRequest,
  onSelectTag,
  onMoveRequest,
  onDownloadRequest,
  onRepeatRequest,
  onDeleteRequest,
}: {
  status: StatusId
  definition: WorkflowStatus
  entries: BoardRequestEntry[]
  tagPaths: Map<string, string>
  tagCopyCounts: Map<string, number>
  isAdmin: boolean
  showRequesters: boolean
  reorderEnabled: boolean
  showPrintType: boolean
  filtered: boolean
  settlingCardKeys: Set<string>
  selectionMode: boolean
  selectedIds: Set<string>
  selectedGroupIds: Map<string, string>
  selectedRequestIds: string[]
  canDeleteSelection: boolean
  canRepeatSelection: boolean
  onOpenRequest: (requestId: string) => void
  onManageTags?: (requestId: string, status: StatusId, count: number, tagIds: string[], groupId?: string) => void
  onSelectRequest: (
    status: StatusId,
    requestId: string,
    orderedIds: string[],
    options: { range: boolean; toggle: boolean },
    groupId?: string,
    cohortId?: string,
  ) => void
  onSelectTag: (status: StatusId, tagId: string) => void
  onMoveRequest?: (requestId: string, status: StatusId, count: number, groupId?: string, ungrouped?: boolean, cohortId?: string) => void
  onDownloadRequest?: (requestId: string, status: StatusId, groupId?: string, cohortId?: string) => void
  onRepeatRequest?: (request: PublicPrintRequest, status: StatusId, groupId?: string, cohortId?: string) => void
  onDeleteRequest?: (requestId: string, status: StatusId, count: number, groupId?: string, cohortId?: string) => void
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
          'column-body virtualized app-scrollbar relative flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto rounded-md px-1 py-2.5 transition-colors',
          isOver && 'bg-blueprint/[0.06] outline-dashed outline-2 outline-offset-4 outline-blueprint/50',
        )}
      >
        {entries.length === 0 && (
          <Empty className="border-0 py-6">
            <EmptyDescription>{filtered ? 'No matching prints in this stage.' : definition.empty}</EmptyDescription>
          </Empty>
        )}
        <div className="virtual-list relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const { request, count, key, groupId, ungrouped } = entries[item.index]
            const tags = request.groups.filter((group) => group.status === status)
            const selectedId = selectedIds.has(key)
              ? key
              : tags.map((tag) => boardCohortId(request.id, status, tag.id)).find((id) => selectedIds.has(id))
            const selected = selectedId !== undefined
            const selectedGroupId = selectedId ? selectedGroupIds.get(selectedId) : undefined
            return (
              <VirtualRow key={key} index={item.index} start={item.start} measureElement={virtualizer.measureElement}>
                <RequestCard
                  request={request}
                  reorderableRequestIds={reorderableRequestIds}
                  status={status}
                  count={count}
                  canDrag={isAdmin || (reorderEnabled && request.mine)}
                  canDragTags={isAdmin}
                  reorderEnabled={reorderEnabled}
                  settling={settlingCardKeys.has(boardCardKey(request.id, status))}
                  selected={selected}
                  selectionMode={selectionMode}
                  selectedRequestIds={selected ? selectedRequestIds : undefined}
                  showPrintType={showPrintType}
                  showPrinter={isAdmin}
                  showRequester={showRequesters}
                  tagPaths={tagPaths}
                  tagCopyCounts={tagCopyCounts}
                  groupId={selectedGroupId ?? groupId}
                  onSelectTag={(tagId) => onSelectTag(status, tagId)}
                  onOpen={() => onOpenRequest(request.id)}
                  ungrouped={ungrouped}
                  onMove={onMoveRequest ? () => onMoveRequest(request.id, status, count, groupId, ungrouped, key) : undefined}
                  onDownload={onDownloadRequest ? () => onDownloadRequest(request.id, status, groupId, key) : undefined}
                  onRepeat={
                    onRepeatRequest && (selected ? canRepeatSelection : isAdmin || request.mine)
                      ? () => onRepeatRequest(request, status, groupId, key)
                      : undefined
                  }
                  onDelete={
                    onDeleteRequest && (selected ? canDeleteSelection : request.canDelete)
                      ? () => onDeleteRequest(request.id, status, count, groupId, key)
                      : undefined
                  }
                  onManageTags={
                    isAdmin && onManageTags
                      ? () =>
                          onManageTags(
                            request.id,
                            status,
                            count,
                            tags.map((tag) => tag.id),
                            groupId,
                          )
                      : undefined
                  }
                  onSelect={(options) =>
                    onSelectRequest(
                      status,
                      request.id,
                      entries.map((entry) => entry.request.id),
                      options,
                      groupId,
                      key,
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
        'virtual-row absolute top-0 left-0 w-full pb-2 will-change-transform hover:z-1 focus-within:z-1 has-[.dragging]:z-2 has-[.dragging]:transition-none',
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
