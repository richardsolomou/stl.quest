import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react'
import { monitorForElements, type ElementEventPayloadMap } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { useServerFn } from '@tanstack/react-start'
import { usePostHog } from '@posthog/react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { requestQueueOrder, type BoardSort, type PrintGroup, type PublicPrintRequest } from '../../core/types'
import { compareCompletedQueue, compareRequesterPriorityQueues, compareRoundRobinQueue } from '../../core/requestQueue'
import type { StatusId, WorkflowDefinition } from '../../core/workflow'
import {
  createPrintGroup,
  deletePrintGroup,
  deleteRequests,
  moveCopies,
  moveCopiesBatch,
  movePrintGroup,
  movePrintGroupItem,
  reorderRequest,
  reorderPrintGroupItem,
  renamePrintGroup,
} from '../../server/fns'
import { canDropOnColumn, canDropOnRequest, shouldSplitStackOnDrop } from '../boardDrag'
import { errorMessage, isReportableMutationError } from '../../core/error'
import { boardEntriesByStatus, boardGroupsByStatus, boardPrioritiesByStatus } from '../boardEntries'
import {
  boardRequestState,
  deleteBoardOverride,
  moveBoardOverride,
  reconcileBoardOverrides,
  reorderBoardOverride,
  type BoardOverride,
} from '../boardOverrides'
import {
  boardBatchDeletions,
  boardBatchMoves,
  boardSelectedCopies,
  boardSelectionEntries,
  selectBoardRequest,
  type BoardSelection,
} from '../boardSelection'
import { Column } from './Column'
import { MoveDialog } from './MoveDialog'
import { BulkMoveDialog } from './BulkMoveDialog'
import { BulkDeleteDialog } from './BulkDeleteDialog'
import { useWorkspaceSlug } from '../workspace'
import { RenameGroupDialog } from './RenameGroupDialog'
import { ConfirmDialog } from './ConfirmDialog'

type PendingMove = {
  requestId: string
  from: StatusId
  to?: StatusId
  destinations?: { id: StatusId; label: string }[]
  max: number
}
type PendingBatchMove = { to?: StatusId; destinations?: { id: StatusId; label: string }[] }
type PendingBatchGroupMove = { groupId: string; groupName: string; status: StatusId }
type PendingGroupItemMove = {
  requestId: string
  requestName: string
  max: number
  fromStatus: StatusId
  toStatus?: StatusId
  toGroupId: string
  toGroupName: string
}

export function Board({
  requests,
  groups,
  workflow,
  isAdmin,
  showRequesters,
  showPrintTypes,
  uploadsEnabled,
  filtered = false,
  sort,
  onOpenRequest,
}: {
  requests: PublicPrintRequest[]
  groups: PrintGroup[]
  workflow: WorkflowDefinition
  isAdmin: boolean
  showRequesters: boolean
  showPrintTypes: boolean
  uploadsEnabled: boolean
  filtered?: boolean
  sort: BoardSort
  onOpenRequest: (requestId: string) => void
}) {
  const workspaceSlug = useWorkspaceSlug()
  const posthog = usePostHog()
  const callMoveCopies = useServerFn(moveCopies)
  const callMoveCopiesBatch = useServerFn(moveCopiesBatch)
  const callDeleteRequests = useServerFn(deleteRequests)
  const callCreatePrintGroup = useServerFn(createPrintGroup)
  const callRenamePrintGroup = useServerFn(renamePrintGroup)
  const callDeletePrintGroup = useServerFn(deletePrintGroup)
  const callMovePrintGroup = useServerFn(movePrintGroup)
  const callMovePrintGroupItem = useServerFn(movePrintGroupItem)
  const callReorder = useServerFn(reorderRequest)
  const callReorderPrintGroupItem = useServerFn(reorderPrintGroupItem)
  const moveMutation = useMutation({ mutationFn: callMoveCopies })
  const batchMoveMutation = useMutation({ mutationFn: callMoveCopiesBatch })
  const deleteMutation = useMutation({ mutationFn: callDeleteRequests })
  const createGroupMutation = useMutation({ mutationFn: callCreatePrintGroup })
  const renameGroupMutation = useMutation({ mutationFn: callRenamePrintGroup })
  const deleteGroupMutation = useMutation({ mutationFn: callDeletePrintGroup })
  const movePrintGroupMutation = useMutation({ mutationFn: callMovePrintGroup })
  const movePrintGroupItemMutation = useMutation({ mutationFn: callMovePrintGroupItem })
  const reorderMutation = useMutation({ mutationFn: callReorder })
  const reorderGroupItemMutation = useMutation({ mutationFn: callReorderPrintGroupItem })
  // Optimistic placement until the live query reflects it; clearing any
  // earlier (e.g. when the server fn resolves) makes copies flash back.
  const [overrides, setOverrides] = useState<Record<string, BoardOverride>>({})
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const [pendingBatchMove, setPendingBatchMove] = useState<PendingBatchMove | null>(null)
  const [pendingBatchGroupMove, setPendingBatchGroupMove] = useState<PendingBatchGroupMove | null>(null)
  const [pendingGroupItemMove, setPendingGroupItemMove] = useState<PendingGroupItemMove | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{ requestId: string; status: StatusId; count: number }>()
  const [renamingGroup, setRenamingGroup] = useState<PrintGroup | null>(null)
  const [deletingGroup, setDeletingGroup] = useState<PrintGroup | null>(null)
  const [batchError, setBatchError] = useState<string>()
  const [selection, setSelection] = useState<BoardSelection | null>(null)
  const [settlingIds, setSettlingIds] = useState<Set<string>>(new Set())
  const priorityStatus = workflow.statuses[0].id
  const completedStatus = workflow.statuses.at(-1)?.id

  const clearSelection = useCallback(() => {
    setSelection(null)
    setPendingBatchMove(null)
    setPendingBatchGroupMove(null)
    setConfirmDelete(false)
    setBatchError(undefined)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && selection && !pendingBatchMove && !confirmDelete) clearSelection()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [clearSelection, confirmDelete, pendingBatchMove, selection])

  const countsOf = useCallback((request: PublicPrintRequest) => boardRequestState(request, overrides[request.id]).counts, [overrides])
  const ordersOf = useCallback((request: PublicPrintRequest) => boardRequestState(request, overrides[request.id]).orders, [overrides])
  const completedAtOf = useCallback(
    (request: PublicPrintRequest) => boardRequestState(request, overrides[request.id]).completedAt,
    [overrides],
  )
  const sortKey = useCallback(
    (request: PublicPrintRequest, status: StatusId) =>
      requestQueueOrder({ orders: ordersOf(request), createdAt: request.createdAt }, status),
    [ordersOf],
  )
  const boardPriorities = useMemo(
    () => boardPrioritiesByStatus(requests, workflow.statuses, overrides),
    [overrides, requests, workflow.statuses],
  )
  const serverRank = useMemo(() => new Map(requests.map((request, index) => [request.id, index])), [requests])
  const compare = useCallback(
    (left: PublicPrintRequest, right: PublicPrintRequest, status: StatusId) =>
      status === completedStatus
        ? compareCompletedQueue(
            { ...left, completedAt: completedAtOf(left) },
            { ...right, completedAt: completedAtOf(right) },
            boardPriorities.get(status) ?? new Map(),
          )
        : sort === 'fair'
          ? compareRequesterPriorityQueues(left, right, boardPriorities.get(status) ?? new Map())
          : sort === 'round-robin'
            ? compareRoundRobinQueue(left, right, boardPriorities.get(status) ?? new Map())
            : (serverRank.get(left.id) ?? 0) - (serverRank.get(right.id) ?? 0),
    [boardPriorities, completedAtOf, completedStatus, serverRank, sort],
  )

  useEffect(() => {
    setOverrides((current) => reconcileBoardOverrides(current, requests))
  }, [requests])

  const revertOverride = useCallback((requestId: string) => {
    setOverrides((prev) => {
      const { [requestId]: _dropped, ...rest } = prev
      return rest
    })
  }, [])

  const performMove = useCallback(
    (requestId: string, from: StatusId, to: StatusId, count: number) => {
      const request = requests.find((j) => j.id === requestId)
      if (!request) return
      setOverrides((current) => ({
        ...current,
        [requestId]: moveBoardOverride(request, current[requestId], from, to, count, completedStatus),
      }))
      moveMutation.mutate(
        { data: { workspaceSlug, id: requestId, from, to, count } },
        {
          onError: (error) => {
            if (isReportableMutationError(error))
              posthog.captureException(error, { action: 'move_request_copies', print_type: request.printType, from, to, count })
            revertOverride(requestId)
          },
        },
      )
    },
    [requests, completedStatus, moveMutation, revertOverride, posthog, workspaceSlug],
  )

  const performReorder = useCallback(
    (requestId: string, status: StatusId, order: number) => {
      const request = requests.find((j) => j.id === requestId)
      if (!request) return
      setOverrides((current) => ({
        ...current,
        [requestId]: reorderBoardOverride(request, current[requestId], status, order),
      }))
      reorderMutation.mutate(
        { data: { workspaceSlug, id: requestId, status, order } },
        {
          onError: (error) => {
            if (isReportableMutationError(error))
              posthog.captureException(error, { action: 'reorder_request', print_type: request.printType, status })
            revertOverride(requestId)
          },
        },
      )
    },
    [requests, reorderMutation, revertOverride, posthog, workspaceSlug],
  )

  const columnForRequester = useCallback(
    (request: PublicPrintRequest, status: StatusId, excludeRequest = false) =>
      requests
        .filter(
          (candidate) =>
            candidate.requesterId === request.requesterId &&
            (!excludeRequest || candidate.id !== request.id) &&
            countsOf(candidate)[status] > 0,
        )
        .sort((left, right) => compare(left, right, status)),
    [compare, countsOf, requests],
  )

  const selectedEntries = useMemo(() => {
    return boardSelectionEntries(requests, selection, countsOf)
  }, [countsOf, requests, selection])
  const adjustableEntries = useMemo(() => selectedEntries.filter(({ max }) => max > 1), [selectedEntries])
  const batchDestinations = useMemo(
    () =>
      selection
        ? workflow.statuses
            .filter((status) => canDropOnColumn(selection.status, status.id))
            .map((status) => ({ id: status.id, label: status.label }))
        : [],
    [selection, workflow.statuses],
  )

  const moveSelected = async (destination: StatusId, counts: Record<string, number>) => {
    if (!selection || selectedEntries.length === 0) return
    setBatchError(undefined)
    try {
      await batchMoveMutation.mutateAsync({
        data: {
          workspaceSlug,
          moves: boardBatchMoves(selectedEntries, selection.status, destination, counts),
        },
      })
      clearSelection()
    } catch (error) {
      if (isReportableMutationError(error)) posthog.captureException(error, { action: 'move_request_batch' })
      setBatchError(errorMessage(error, 'The group could not be moved.'))
    }
  }

  const openBatchMove = (to?: StatusId) => {
    if (!selection || selectedEntries.length === 0) return
    if (to && adjustableEntries.length === 0) {
      void moveSelected(to, {})
      return
    }
    if (to || batchDestinations.length > 0) {
      setBatchError(undefined)
      setPendingBatchMove({ to, destinations: to ? undefined : batchDestinations })
    }
  }

  const moveSelectedToGroup = async (target: PendingBatchGroupMove, counts: Record<string, number>) => {
    if (!selection || selectedEntries.length === 0) return
    setBatchError(undefined)
    try {
      await Promise.all(
        boardSelectedCopies(selectedEntries, counts).map(({ request, count }) =>
          movePrintGroupItemMutation.mutateAsync({
            data: {
              workspaceSlug,
              requestId: request.id,
              count,
              status: selection.status,
              toStatus: target.status === selection.status ? undefined : target.status,
              toGroupId: target.groupId,
            },
          }),
        ),
      )
      clearSelection()
    } catch (error) {
      if (isReportableMutationError(error)) posthog.captureException(error, { action: 'move_request_batch_to_group' })
      setBatchError(errorMessage(error, 'The requests could not be added to the group.'))
    }
  }

  const openBatchGroupMove = (target: PendingBatchGroupMove) => {
    if (adjustableEntries.length === 0) {
      void moveSelectedToGroup(target, {})
      return
    }
    setBatchError(undefined)
    setPendingBatchGroupMove(target)
  }

  const handleDrop = useEffectEvent(({ source, location }: ElementEventPayloadMap['onDrop']) => {
    const requestId = source.data.requestId
    const from = source.data.from as StatusId
    const selectedRequestIds = Array.isArray(source.data.selectedRequestIds)
      ? source.data.selectedRequestIds.filter((id): id is string => typeof id === 'string')
      : []
    const fromGroupId = typeof source.data.groupId === 'string' ? source.data.groupId : undefined
    if (source.data.type === 'print-group') {
      const target = location.current.dropTargets.find((candidate) => candidate.data.type === 'column')
      const to = target?.data.status as StatusId | undefined
      if (!isAdmin || !fromGroupId || !to || !canDropOnColumn(from, to)) return
      movePrintGroupMutation.mutate({ data: { workspaceSlug, id: fromGroupId, to } })
      return
    }
    const cardTarget = location.current.dropTargets.find((candidate) => candidate.data.type === 'card')
    const target =
      (fromGroupId && cardTarget?.data.groupId === fromGroupId ? cardTarget : undefined) ??
      location.current.dropTargets.find((candidate) => candidate.data.type === 'group') ??
      (fromGroupId ? location.current.dropTargets.find((candidate) => candidate.data.type === 'column') : undefined) ??
      location.current.dropTargets[0]
    if (typeof requestId !== 'string' || !target) return
    setSettlingIds((current) => new Set(current).add(requestId))
    window.setTimeout(() => setSettlingIds((current) => new Set([...current].filter((id) => id !== requestId))), 260)

    const sourceRequest = requests.find((request) => request.id === requestId)
    if (!sourceRequest) return
    const count = typeof source.data.count === 'number' ? source.data.count : undefined
    if (target.data.type === 'card' && fromGroupId && target.data.groupId === fromGroupId) {
      const targetRequestId = target.data.requestId
      if (!isAdmin || typeof targetRequestId !== 'string' || targetRequestId === requestId) return
      reorderGroupItemMutation.mutate({
        data: {
          workspaceSlug,
          groupId: fromGroupId,
          requestId,
          targetRequestId,
          edge: extractClosestEdge(target.data) === 'bottom' ? 'after' : 'before',
        },
      })
      return
    }
    if (target.data.type === 'group') {
      const toGroupId = typeof target.data.groupId === 'string' ? target.data.groupId : undefined
      const status = target.data.status as StatusId
      if (!isAdmin || !toGroupId || !count || fromGroupId === toGroupId) return
      const selectedDrag =
        !fromGroupId &&
        selectedRequestIds.length > 0 &&
        selection?.status === from &&
        selectedRequestIds.every((id) => selection.ids.has(id))
      if (selectedDrag) {
        const toGroup = groups.find((group) => group.id === toGroupId)
        if (!toGroup) return
        openBatchGroupMove({ groupId: toGroupId, groupName: toGroup.name, status })
        return
      }
      if (!fromGroupId && count > 1) {
        const toGroup = groups.find((group) => group.id === toGroupId)
        if (!toGroup) return
        setPendingGroupItemMove({
          requestId,
          requestName: sourceRequest.name,
          max: count,
          fromStatus: from,
          toStatus: status === from ? undefined : status,
          toGroupId,
          toGroupName: toGroup.name,
        })
        return
      }
      movePrintGroupItemMutation.mutate({
        data: { workspaceSlug, requestId, count, status: from, fromGroupId, toGroupId, toStatus: status === from ? undefined : status },
      })
      return
    }
    if (target.data.type === 'column' && fromGroupId) {
      if (!isAdmin || !count) return
      const toStatus = target.data.status as StatusId
      movePrintGroupItemMutation.mutate({
        data: { workspaceSlug, requestId, count, status: from, fromGroupId, toStatus: toStatus === from ? undefined : toStatus },
      })
      return
    }
    let to: StatusId
    if (target.data.type === 'card') {
      const targetRequest = requests.find((request) => request.id === target.data.requestId)
      if (!targetRequest) return
      if (
        !canDropOnRequest(
          source.data,
          { requesterId: targetRequest.requesterId, requestId: targetRequest.id, status: target.data.status as StatusId },
          sort === 'fair' && sourceRequest.mine,
        )
      )
        return
      to = target.data.status as StatusId
      if (to === from) {
        if (sort !== 'fair' || !sourceRequest.mine || to !== priorityStatus) return
        const list = columnForRequester(sourceRequest, to, true)
        const index = list.findIndex((request) => request.id === targetRequest.id)
        if (index >= 0) {
          const edge = extractClosestEdge(target.data)
          const before = edge === 'top' ? list[index - 1] : list[index]
          const after = edge === 'top' ? list[index] : list[index + 1]
          const order =
            before && after
              ? (sortKey(before, to) + sortKey(after, to)) / 2
              : before
                ? sortKey(before, to) + 1
                : after
                  ? sortKey(after, to) - 1
                  : 0
          performReorder(requestId, from, order)
        }
        return
      }
    } else if (target.data.type === 'column') {
      to = target.data.status as StatusId
      if (!canDropOnColumn(from, to)) return
    } else return

    if (!isAdmin) return
    if (selectedRequestIds.length > 0 && selection?.status === from && selectedRequestIds.every((id) => selection.ids.has(id))) {
      openBatchMove(to)
      return
    }
    const request = requests.find((j) => j.id === requestId)
    if (!request) return
    const grouped = request.groups.filter((group) => group.status === from).reduce((sum, group) => sum + group.count, 0)
    const available = Math.min(count ?? Infinity, countsOf(request)[from] - grouped, request.counts[from] - grouped)
    if (available <= 0) return
    if (available === 1 || !shouldSplitStackOnDrop(location.current.input)) performMove(requestId, from, to, available)
    else setPendingMove({ requestId, from, to, max: available })
  })

  useEffect(() => monitorForElements({ onDrop: handleDrop }), [])

  const pendingRequest = pendingMove ? requests.find((j) => j.id === pendingMove.requestId) : undefined
  const pendingDeleteRequest = pendingDelete ? requests.find((request) => request.id === pendingDelete.requestId) : undefined
  const reorderEnabled = sort === 'fair'
  const statusEntries = useMemo(
    () => boardEntriesByStatus(requests, groups, workflow.statuses, countsOf, compare),
    [groups, compare, countsOf, requests, workflow.statuses],
  )
  const groupEntries = useMemo(() => boardGroupsByStatus(requests, groups), [groups, requests])
  const startSelection = (status: StatusId) => {
    const first = requests.find((request) => countsOf(request)[status] > 0)?.id
    if (first) setSelection({ status, ids: new Set(), anchorId: first })
  }

  if (requests.length === 0) {
    return (
      <main className="grid min-h-0 flex-1 place-items-center p-6 text-center">
        <div className="max-w-md rounded-xl border bg-card/40 p-7">
          <h2 className="font-heading text-xl font-semibold">
            {filtered ? 'No prints match these filters' : 'Your production queue is ready'}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {filtered
              ? 'Clear or adjust the filters to see resin and filament requests in the queue.'
              : uploadsEnabled
                ? 'Add a private STL request to start tracking copies from Queue through Up next, Printing, Finishing, and Ready.'
                : 'Explore the workspace now, then configure storage when you are ready to add print requests.'}
          </p>
        </div>
      </main>
    )
  }

  return (
    <main
      className="board relative flex min-h-0 flex-1 flex-col overflow-x-auto"
      onPointerDown={(event) => {
        if (!selection) return
        const target = event.target as Element
        if (!target.closest('.board')) return
        if (!target.closest('.card,button,input,[role="dialog"],[data-selection-controls]')) clearSelection()
      }}
    >
      <div className="line flex gap-3 border-b-2 border-dashed border-blueprint/25 px-3 pt-3 pb-2.5">
        {workflow.statuses.map((definition) => {
          const status = definition.id
          const { entries, total } = statusEntries.get(status) ?? { entries: [], total: 0 }
          return (
            <div
              key={status}
              data-status={status}
              data-slot="column-header"
              className="flex min-w-[280px] flex-1 shrink-0 items-center gap-2 font-heading text-xs font-semibold tracking-[0.08em] text-foreground uppercase max-[900px]:w-[82%] max-[900px]:flex-none"
            >
              <span
                className={cn(
                  'size-2 shrink-0 rounded-full bg-muted-foreground',
                  status === 'up_next' && 'bg-blueprint',
                  status === 'in_progress' && 'bg-primary',
                  status === 'post_processing' && 'bg-[var(--chart-4)]',
                  status === 'done' && 'bg-[var(--chart-2)]',
                )}
              />
              <span className="truncate">{definition.label}</span>
              {isAdmin && entries.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="ml-auto shrink-0 normal-case tracking-normal min-[901px]:hidden"
                  onClick={() => startSelection(status)}
                >
                  Select
                </Button>
              )}
              <span
                className={cn(
                  'shrink-0 rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground',
                  !isAdmin && 'ml-auto',
                )}
                title="Copies"
              >
                {total}
              </span>
            </div>
          )
        })}
      </div>
      <div className="grid min-h-0 flex-1 grid-flow-col grid-cols-none auto-cols-[minmax(280px,1fr)] gap-3 p-3 max-[900px]:auto-cols-[82%]">
        {workflow.statuses.map((definition) => {
          const status = definition.id
          const { entries } = statusEntries.get(status) ?? { entries: [], total: 0 }
          return (
            <Column
              key={status}
              status={status}
              definition={definition}
              entries={entries}
              groups={groupEntries.get(status) ?? []}
              isAdmin={isAdmin}
              showRequesters={showRequesters}
              reorderEnabled={reorderEnabled && status === priorityStatus}
              showPrintType={showPrintTypes}
              filtered={filtered}
              settlingIds={settlingIds}
              selectionStatus={selection?.status}
              selectedIds={selection?.ids ?? new Set()}
              onOpenRequest={onOpenRequest}
              onMoveRequest={
                isAdmin
                  ? (requestId, from, count) => {
                      if (selection?.status === from && selection.ids.has(requestId)) {
                        openBatchMove()
                        return
                      }
                      setPendingMove({
                        requestId,
                        from,
                        destinations: workflow.statuses
                          .filter((candidate) => canDropOnColumn(from, candidate.id))
                          .map((candidate) => ({ id: candidate.id, label: candidate.label })),
                        max: count,
                      })
                    }
                  : undefined
              }
              onDeleteRequest={
                isAdmin
                  ? (requestId, cardStatus, count) => {
                      if (selection?.status === cardStatus && selection.ids.has(requestId)) {
                        setConfirmDelete(true)
                        return
                      }
                      setPendingDelete({ requestId, status: cardStatus, count })
                    }
                  : undefined
              }
              onCreateGroup={(requestId, groupStatus, count) => {
                const items =
                  selection?.status === groupStatus && selection.ids.has(requestId)
                    ? selectedEntries.map(({ request, max }) => ({ requestId: request.id, count: max }))
                    : [{ requestId, count }]
                createGroupMutation.mutate({ data: { workspaceSlug, status: groupStatus, items } })
                clearSelection()
              }}
              onRenameGroup={setRenamingGroup}
              onDeleteGroup={setDeletingGroup}
              onSelectRequest={(columnStatus, requestId, orderedIds, options) =>
                setSelection((current) => selectBoardRequest(current, columnStatus, orderedIds, requestId, options))
              }
            />
          )
        })}
      </div>
      {pendingMove && pendingRequest && (
        <MoveDialog
          requestName={pendingRequest.name}
          toLabel={pendingMove.to ? (workflow.statuses.find((status) => status.id === pendingMove.to)?.label ?? pendingMove.to) : undefined}
          destinations={pendingMove.destinations}
          max={pendingMove.max}
          onConfirm={(count, selectedDestination) => {
            const to = pendingMove.to ?? selectedDestination
            if (!to) return
            performMove(pendingMove.requestId, pendingMove.from, to, count)
            setPendingMove(null)
          }}
          onCancel={() => setPendingMove(null)}
        />
      )}
      {pendingGroupItemMove && (
        <MoveDialog
          requestName={pendingGroupItemMove.requestName}
          toLabel={`group “${pendingGroupItemMove.toGroupName}”`}
          max={pendingGroupItemMove.max}
          onConfirm={(count) => {
            movePrintGroupItemMutation.mutate({
              data: {
                workspaceSlug,
                requestId: pendingGroupItemMove.requestId,
                count,
                status: pendingGroupItemMove.fromStatus,
                toStatus: pendingGroupItemMove.toStatus,
                toGroupId: pendingGroupItemMove.toGroupId,
              },
            })
            setPendingGroupItemMove(null)
          }}
          onCancel={() => setPendingGroupItemMove(null)}
        />
      )}
      {pendingBatchMove && selection && selectedEntries.length > 0 && (
        <BulkMoveDialog
          entries={adjustableEntries}
          requestCount={selectedEntries.length}
          destination={pendingBatchMove.to}
          destinations={pendingBatchMove.destinations}
          pending={batchMoveMutation.isPending}
          error={batchError}
          onConfirm={(counts, destination) => void moveSelected(destination, counts)}
          onCancel={() => {
            if (!batchMoveMutation.isPending) {
              setPendingBatchMove(null)
              setBatchError(undefined)
            }
          }}
        />
      )}
      {pendingBatchGroupMove && selection && selectedEntries.length > 0 && (
        <BulkMoveDialog
          entries={adjustableEntries}
          requestCount={selectedEntries.length}
          destination={pendingBatchGroupMove.status}
          pending={movePrintGroupItemMutation.isPending}
          error={batchError}
          onConfirm={(counts) => void moveSelectedToGroup(pendingBatchGroupMove, counts)}
          onCancel={() => {
            if (!movePrintGroupItemMutation.isPending) {
              setPendingBatchGroupMove(null)
              setBatchError(undefined)
            }
          }}
        />
      )}
      {confirmDelete && selection && selectedEntries.length > 0 && (
        <BulkDeleteDialog
          entries={boardSelectedCopies(selectedEntries)}
          pending={deleteMutation.isPending}
          error={batchError}
          onConfirm={async () => {
            setBatchError(undefined)
            try {
              await deleteMutation.mutateAsync({
                data: {
                  workspaceSlug,
                  deletions: boardBatchDeletions(selectedEntries, selection.status),
                },
              })
              clearSelection()
            } catch (error) {
              if (isReportableMutationError(error)) posthog.captureException(error, { action: 'delete_request_batch' })
              setBatchError(errorMessage(error, undefined))
            }
          }}
          onCancel={() => {
            if (!deleteMutation.isPending) {
              setConfirmDelete(false)
              setBatchError(undefined)
            }
          }}
        />
      )}
      {pendingDeleteRequest && pendingDelete && (
        <BulkDeleteDialog
          entries={[
            {
              request: pendingDeleteRequest,
              count: pendingDelete.count,
            },
          ]}
          title={`Delete ${pendingDelete.count} ${pendingDelete.count === 1 ? 'copy' : 'copies'} of “${pendingDeleteRequest.name}”?`}
          pending={deleteMutation.isPending}
          error={batchError}
          onConfirm={async () => {
            setBatchError(undefined)
            setOverrides((current) => ({
              ...current,
              [pendingDeleteRequest.id]: deleteBoardOverride(
                pendingDeleteRequest,
                current[pendingDeleteRequest.id],
                pendingDelete.status,
                pendingDelete.count,
              ),
            }))
            setPendingDelete(undefined)
            try {
              await deleteMutation.mutateAsync({
                data: {
                  workspaceSlug,
                  deletions: [{ id: pendingDeleteRequest.id, status: pendingDelete.status, count: pendingDelete.count }],
                },
              })
            } catch (error) {
              revertOverride(pendingDeleteRequest.id)
              setPendingDelete(pendingDelete)
              if (isReportableMutationError(error)) posthog.captureException(error, { action: 'delete_request' })
              setBatchError(errorMessage(error, undefined))
            }
          }}
          onCancel={() => {
            if (!deleteMutation.isPending) {
              setPendingDelete(undefined)
              setBatchError(undefined)
            }
          }}
        />
      )}
      {renamingGroup && (
        <RenameGroupDialog
          title="Rename print group"
          initialName={renamingGroup.name}
          submitLabel="Rename group"
          pending={renameGroupMutation.isPending}
          error={batchError}
          onConfirm={async (name) => {
            setBatchError(undefined)
            try {
              await renameGroupMutation.mutateAsync({ data: { workspaceSlug, id: renamingGroup.id, name } })
              setRenamingGroup(null)
            } catch (error) {
              setBatchError(errorMessage(error, 'The group could not be renamed.'))
            }
          }}
          onCancel={() => setRenamingGroup(null)}
        />
      )}
      {deletingGroup && (
        <ConfirmDialog
          open
          title={`Delete “${deletingGroup.name}”?`}
          description="Only the group is removed. Every print in it stays on the board in this stage, ungrouped."
          confirmLabel="Delete group"
          destructive
          pending={deleteGroupMutation.isPending}
          problem={
            batchError ? { title: 'The group was not deleted', hint: 'It is still on the board. Try again.', error: batchError } : undefined
          }
          onConfirm={async () => {
            setBatchError(undefined)
            try {
              await deleteGroupMutation.mutateAsync({ data: { workspaceSlug, id: deletingGroup.id } })
              setDeletingGroup(null)
            } catch (error) {
              setBatchError(errorMessage(error, 'The group could not be deleted.'))
            }
          }}
          onCancel={() => {
            setDeletingGroup(null)
            setBatchError(undefined)
          }}
        />
      )}
    </main>
  )
}
