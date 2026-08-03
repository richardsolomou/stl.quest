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
import { printGroupPaths } from '../../core/printGroups'
import type { StatusId, WorkflowDefinition } from '../../core/workflow'
import {
  createPrintGroup,
  deleteRequests,
  moveCopies,
  moveCopiesBatch,
  movePrintGroup,
  movePrintGroupItem,
  reorderRequest,
  reorderPrintGroupItem,
  repeatRequest,
  tagPrintCopies,
  untagPrintCopies,
} from '../../server/fns'
import { canDropOnColumn, canDropOnRequest, shouldSplitStackOnDrop } from '../boardDrag'
import { errorMessage, isReportableMutationError } from '../../core/error'
import { boardEntriesByStatus, boardPrioritiesByStatus } from '../boardEntries'
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
  boardRequestSelected,
  boardSelectedCopies,
  boardSelectedRequestIds,
  boardSelectionEntries,
  selectBoardRequest,
  type BoardSelection,
} from '../boardSelection'
import { Column } from './Column'
import { MoveDialog } from './MoveDialog'
import { BulkMoveDialog } from './BulkMoveDialog'
import { BulkDeleteDialog } from './BulkDeleteDialog'
import { useWorkspaceSlug } from '../workspace'
import { signalProductTourProgress } from '../productTour'
import { RepeatRequestDialog } from './RepeatRequestDialog'
import { TagPickerDialog } from './TagPickerDialog'

type PendingMove = {
  requestId: string
  from: StatusId
  to?: StatusId
  destinations?: { id: StatusId; label: string }[]
  max: number
  discoversActions?: boolean
}
type PendingBatchMove = { to?: StatusId; destinations?: { id: StatusId; label: string }[] }
type PendingBatchGroupMove = { groupId: string; groupName: string; status: StatusId }
type PendingTags = { status: StatusId; items: { requestId: string; count: number }[]; selectedTagIds: Set<string> }
type PendingGroupItemMove = {
  requestId: string
  requestName: string
  max: number
  fromStatus: StatusId
  fromGroupId?: string
  toStatus?: StatusId
  toGroupId?: string
  toLabel: string
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
  const callTagPrintCopies = useServerFn(tagPrintCopies)
  const callUntagPrintCopies = useServerFn(untagPrintCopies)
  const callMovePrintGroup = useServerFn(movePrintGroup)
  const callMovePrintGroupItem = useServerFn(movePrintGroupItem)
  const callReorder = useServerFn(reorderRequest)
  const callReorderPrintGroupItem = useServerFn(reorderPrintGroupItem)
  const callRepeatRequest = useServerFn(repeatRequest)
  const moveMutation = useMutation({ mutationFn: callMoveCopies })
  const batchMoveMutation = useMutation({ mutationFn: callMoveCopiesBatch })
  const deleteMutation = useMutation({ mutationFn: callDeleteRequests })
  const createGroupMutation = useMutation({
    mutationFn: callCreatePrintGroup,
    onSuccess: () => signalProductTourProgress('actions'),
  })
  const tagCopiesMutation = useMutation({ mutationFn: callTagPrintCopies })
  const untagCopiesMutation = useMutation({ mutationFn: callUntagPrintCopies })
  const movePrintGroupMutation = useMutation({ mutationFn: callMovePrintGroup })
  const movePrintGroupItemMutation = useMutation({ mutationFn: callMovePrintGroupItem })
  const reorderMutation = useMutation({ mutationFn: callReorder })
  const reorderGroupItemMutation = useMutation({ mutationFn: callReorderPrintGroupItem })
  const repeatMutation = useMutation({
    mutationFn: ({ requests: repeated, quantity }: { requests: PublicPrintRequest[]; quantity: number }) =>
      Promise.all(repeated.map((request) => callRepeatRequest({ data: { workspaceSlug, id: request.id, quantity } }))),
  })
  // Optimistic placement until the live query reflects it; clearing any
  // earlier (e.g. when the server fn resolves) makes copies flash back.
  const [overrides, setOverrides] = useState<Record<string, BoardOverride>>({})
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const [pendingBatchMove, setPendingBatchMove] = useState<PendingBatchMove | null>(null)
  const [pendingBatchGroupMove, setPendingBatchGroupMove] = useState<PendingBatchGroupMove | null>(null)
  const [pendingGroupItemMove, setPendingGroupItemMove] = useState<PendingGroupItemMove | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{ requestId: string; status: StatusId; count: number }>()
  const [pendingTags, setPendingTags] = useState<PendingTags | null>(null)
  const [batchError, setBatchError] = useState<string>()
  const [selection, setSelection] = useState<BoardSelection | null>(null)
  const [repeatingRequests, setRepeatingRequests] = useState<PublicPrintRequest[]>([])
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
  const groupsOf = useCallback((request: PublicPrintRequest) => boardRequestState(request, overrides[request.id]).groups, [overrides])
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
    (requestId: string, from: StatusId, to: StatusId, count: number, discoversActions = false) => {
      const request = requests.find((j) => j.id === requestId)
      if (!request) return
      setOverrides((current) => ({
        ...current,
        [requestId]: moveBoardOverride(request, current[requestId], from, to, count, completedStatus),
      }))
      moveMutation.mutate(
        { data: { workspaceSlug, id: requestId, from, to, count } },
        {
          onSuccess: () => {
            signalProductTourProgress('move')
            if (discoversActions) signalProductTourProgress('actions')
          },
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
  const selectedStatuses = useMemo(() => new Set(selectedEntries.map(({ status }) => status)), [selectedEntries])
  const selectionStatus = selectedStatuses.size === 1 ? selectedStatuses.values().next().value : undefined
  const selectedGroupIds = useMemo(() => new Set(selectedEntries.map(({ groupId }) => groupId)), [selectedEntries])
  const selectionGroupId = selectedGroupIds.size === 1 ? selectedGroupIds.values().next().value : undefined
  const batchDestinations = useMemo(
    () =>
      selection
        ? workflow.statuses
            .filter((status) => [...selectedStatuses].every((from) => canDropOnColumn(from, status.id)))
            .map((status) => ({ id: status.id, label: status.label }))
        : [],
    [selection, selectedStatuses, workflow.statuses],
  )

  const moveSelected = async (destination: StatusId, counts: Record<string, number>) => {
    if (!selection || selectedEntries.length === 0) return
    setBatchError(undefined)
    try {
      const copies = boardSelectedCopies(selectedEntries, counts)
      const grouped = copies.filter(({ groupId }) => groupId)
      const ungrouped = selectedEntries.filter(({ groupId }) => !groupId)
      if (ungrouped.length) {
        await batchMoveMutation.mutateAsync({
          data: { workspaceSlug, moves: boardBatchMoves(ungrouped, destination, counts) },
        })
      }
      await Promise.all(
        grouped.map(({ request, status, groupId, count }) =>
          movePrintGroupItemMutation.mutateAsync({
            data: {
              workspaceSlug,
              requestId: request.id,
              count,
              status,
              fromGroupId: groupId,
              toStatus: destination === status ? undefined : destination,
            },
          }),
        ),
      )
      signalProductTourProgress('actions')
      clearSelection()
    } catch (error) {
      if (isReportableMutationError(error)) posthog.captureException(error, { action: 'move_request_batch' })
      setBatchError(errorMessage(error, 'The group could not be moved.'))
    }
  }

  const openBatchMove = (to?: StatusId, chooseCounts = false) => {
    if (!selection || selectedEntries.length === 0) return
    if (to && (!chooseCounts || adjustableEntries.length === 0)) {
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
        boardSelectedCopies(selectedEntries, counts).map(({ request, status, groupId, count }) =>
          movePrintGroupItemMutation.mutateAsync({
            data: {
              workspaceSlug,
              requestId: request.id,
              count,
              status,
              fromGroupId: groupId,
              toStatus: target.status === status ? undefined : target.status,
              toGroupId: target.groupId,
            },
          }),
        ),
      )
      signalProductTourProgress('actions')
      clearSelection()
    } catch (error) {
      if (isReportableMutationError(error)) posthog.captureException(error, { action: 'move_request_batch_to_group' })
      setBatchError(errorMessage(error, 'The requests could not be added to the group.'))
    }
  }

  const openBatchGroupMove = (target: PendingBatchGroupMove, chooseCounts = false) => {
    if (!chooseCounts || adjustableEntries.length === 0) {
      void moveSelectedToGroup(target, {})
      return
    }
    setBatchError(undefined)
    setPendingBatchGroupMove(target)
  }

  const downloadRequests = (ids: string[]) => {
    const link = document.createElement('a')
    link.href =
      ids.length === 1 ? `/api/files/${ids[0]}` : `/api/files/batch?${new URLSearchParams(ids.map((id) => ['id', id])).toString()}`
    link.download = ''
    link.click()
    const properties =
      ids.length === 1 ? { print_type: requests.find(({ id }) => id === ids[0])?.printType } : { request_count: ids.length }
    posthog.capture(ids.length === 1 ? 'stl_downloaded' : 'stl_batch_downloaded', properties)
    signalProductTourProgress('download')
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
      movePrintGroupMutation.mutate({ data: { workspaceSlug, id: fromGroupId, from, to } })
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
    const splitStack = source.data.splitStack === true || shouldSplitStackOnDrop(location.current.input)
    if (target.data.type === 'card' && fromGroupId && target.data.groupId === fromGroupId) {
      const targetRequestId = target.data.requestId
      if (!isAdmin || typeof targetRequestId !== 'string' || targetRequestId === requestId) return
      reorderGroupItemMutation.mutate({
        data: {
          workspaceSlug,
          groupId: fromGroupId,
          status: from,
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
        selectedRequestIds.length > 0 &&
        selectionStatus === from &&
        selectionGroupId === fromGroupId &&
        selectedRequestIds.every((id) => selection?.statuses.get(id) === from)
      if (selectedDrag) {
        const toGroup = groups.find((group) => group.id === toGroupId)
        if (!toGroup) return
        openBatchGroupMove({ groupId: toGroupId, groupName: toGroup.name, status }, splitStack)
        return
      }
      if (count > 1 && splitStack) {
        const toGroup = groups.find((group) => group.id === toGroupId)
        if (!toGroup) return
        setPendingGroupItemMove({
          requestId,
          requestName: sourceRequest.name,
          max: count,
          fromStatus: from,
          fromGroupId,
          toStatus: status === from ? undefined : status,
          toGroupId,
          toLabel: `group “${toGroup.name}”`,
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
      const selectedDrag = selection?.statuses.get(requestId) === from && selection.groupIds.get(requestId) === fromGroupId
      if (selectedDrag) {
        openBatchMove(toStatus, splitStack)
        return
      }
      if (count > 1 && splitStack) {
        setPendingGroupItemMove({
          requestId,
          requestName: sourceRequest.name,
          max: count,
          fromStatus: from,
          fromGroupId,
          toStatus: toStatus === from ? undefined : toStatus,
          toLabel: workflow.statuses.find((status) => status.id === toStatus)?.label ?? toStatus,
        })
        return
      }
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
    if (selectedRequestIds.length > 0 && selection?.statuses.get(requestId) === from) {
      openBatchMove(to, splitStack)
      return
    }
    const request = requests.find((j) => j.id === requestId)
    if (!request) return
    const available = Math.min(count ?? Infinity, countsOf(request)[from], request.counts[from])
    if (available <= 0) return
    if (available === 1 || !splitStack) performMove(requestId, from, to, available)
    else setPendingMove({ requestId, from, to, max: available })
  })

  useEffect(() => monitorForElements({ onDrop: handleDrop }), [])

  const pendingRequest = pendingMove ? requests.find((j) => j.id === pendingMove.requestId) : undefined
  const pendingDeleteRequest = pendingDelete ? requests.find((request) => request.id === pendingDelete.requestId) : undefined
  const reorderEnabled = sort === 'fair'
  const statusEntries = useMemo(
    () => boardEntriesByStatus(requests, groups, workflow.statuses, countsOf, groupsOf, compare),
    [groups, compare, countsOf, groupsOf, requests, workflow.statuses],
  )
  const tagPaths = useMemo(() => printGroupPaths(groups), [groups])
  const startSelection = (status: StatusId) => {
    const first = requests.find((request) => countsOf(request)[status] > 0)?.id
    if (first) setSelection({ statuses: new Map(), groupIds: new Map(), anchorId: first, anchorStatus: status })
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
              tagPaths={tagPaths}
              isAdmin={isAdmin}
              showRequesters={showRequesters}
              reorderEnabled={reorderEnabled && status === priorityStatus}
              showPrintType={showPrintTypes}
              filtered={filtered}
              settlingIds={settlingIds}
              selectionMode={selection !== null}
              selectedIds={boardSelectedRequestIds(selection, status)}
              selectedRequestIds={[...boardSelectedRequestIds(selection)]}
              onOpenRequest={onOpenRequest}
              onMoveRequest={
                isAdmin
                  ? (requestId, from, count, groupId) => {
                      if (boardRequestSelected(selection, from, requestId, groupId)) {
                        openBatchMove()
                        return
                      }
                      setPendingMove({
                        requestId,
                        from,
                        discoversActions: true,
                        destinations: workflow.statuses
                          .filter((candidate) => canDropOnColumn(from, candidate.id))
                          .map((candidate) => ({ id: candidate.id, label: candidate.label })),
                        max: count,
                      })
                    }
                  : undefined
              }
              onDownloadRequest={(requestId, cardStatus, groupId) => {
                const ids = boardRequestSelected(selection, cardStatus, requestId, groupId) ? [...selection!.statuses.keys()] : [requestId]
                downloadRequests(ids)
              }}
              onRepeatRequest={(request, cardStatus, groupId) => {
                const selected = boardRequestSelected(selection, cardStatus, request.id, groupId)
                setRepeatingRequests(
                  selected ? selectedEntries.map((entry) => entry.request).filter((candidate) => isAdmin || candidate.mine) : [request],
                )
              }}
              onDeleteRequest={
                isAdmin
                  ? (requestId, cardStatus, count, groupId) => {
                      if (boardRequestSelected(selection, cardStatus, requestId, groupId)) {
                        setConfirmDelete(true)
                        return
                      }
                      setPendingDelete({ requestId, status: cardStatus, count })
                    }
                  : undefined
              }
              onManageTags={
                selection && selectionStatus === undefined
                  ? undefined
                  : (requestId, groupStatus, count, tagIds, groupId) => {
                      const items = boardRequestSelected(selection, groupStatus, requestId, groupId)
                        ? selectedEntries.map(({ request, max }) => ({ requestId: request.id, count: max }))
                        : [{ requestId, count }]
                      const selectedTagIds = boardRequestSelected(selection, groupStatus, requestId, groupId)
                        ? new Set(
                            groups
                              .filter((tag) =>
                                items.every((item) =>
                                  requests
                                    .find((candidate) => candidate.id === item.requestId)
                                    ?.groups.some((assignment) => assignment.id === tag.id && assignment.status === groupStatus),
                                ),
                              )
                              .map((tag) => tag.id),
                          )
                        : new Set(tagIds)
                      setPendingTags({ status: groupStatus, items, selectedTagIds })
                      clearSelection()
                    }
              }
              onSelectRequest={(columnStatus, requestId, orderedIds, options, groupId) =>
                setSelection((current) => selectBoardRequest(current, columnStatus, orderedIds, requestId, options, groupId))
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
            performMove(pendingMove.requestId, pendingMove.from, to, count, pendingMove.discoversActions)
            setPendingMove(null)
          }}
          onCancel={() => setPendingMove(null)}
        />
      )}
      {repeatingRequests.length > 0 && (
        <RepeatRequestDialog
          requestNames={repeatingRequests.map((request) => request.name)}
          quantity={repeatingRequests[0].quantity}
          pending={repeatMutation.isPending}
          error={repeatMutation.error ? errorMessage(repeatMutation.error, 'The server did not create the request.') : undefined}
          onConfirm={(quantity) =>
            repeatMutation.mutate(
              { requests: repeatingRequests, quantity },
              {
                onSuccess: () => {
                  setRepeatingRequests([])
                  clearSelection()
                },
              },
            )
          }
          onCancel={() => {
            repeatMutation.reset()
            setRepeatingRequests([])
          }}
        />
      )}
      {pendingGroupItemMove && (
        <MoveDialog
          requestName={pendingGroupItemMove.requestName}
          toLabel={pendingGroupItemMove.toLabel}
          max={pendingGroupItemMove.max}
          onConfirm={(count) => {
            movePrintGroupItemMutation.mutate({
              data: {
                workspaceSlug,
                requestId: pendingGroupItemMove.requestId,
                count,
                status: pendingGroupItemMove.fromStatus,
                fromGroupId: pendingGroupItemMove.fromGroupId,
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
                  deletions: boardBatchDeletions(selectedEntries),
                },
              })
              signalProductTourProgress('actions')
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
              signalProductTourProgress('actions')
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
      {pendingTags && (
        <TagPickerDialog
          tags={groups}
          selectedTagIds={pendingTags.selectedTagIds}
          pending={createGroupMutation.isPending || tagCopiesMutation.isPending || untagCopiesMutation.isPending}
          error={batchError}
          onToggle={async (groupId, selected) => {
            setBatchError(undefined)
            try {
              if (selected) {
                await tagCopiesMutation.mutateAsync({
                  data: { workspaceSlug, groupId, status: pendingTags.status, items: pendingTags.items },
                })
              } else {
                await untagCopiesMutation.mutateAsync({
                  data: {
                    workspaceSlug,
                    groupId,
                    status: pendingTags.status,
                    requestIds: pendingTags.items.map((item) => item.requestId),
                  },
                })
              }
              setPendingTags((current) => {
                if (!current) return current
                const selectedTagIds = new Set(current.selectedTagIds)
                if (selected) selectedTagIds.add(groupId)
                else selectedTagIds.delete(groupId)
                return { ...current, selectedTagIds }
              })
            } catch (error) {
              setBatchError(errorMessage(error, 'The tags could not be updated.'))
            }
          }}
          onCreate={async (name) => {
            setBatchError(undefined)
            try {
              const groupId = await createGroupMutation.mutateAsync({
                data: { workspaceSlug, name, status: pendingTags.status, items: pendingTags.items },
              })
              setPendingTags((current) => {
                if (!current) return current
                return { ...current, selectedTagIds: new Set(current.selectedTagIds).add(groupId) }
              })
            } catch (error) {
              setBatchError(errorMessage(error, 'The tag could not be created.'))
            }
          }}
          onCancel={() => {
            if (!createGroupMutation.isPending && !tagCopiesMutation.isPending && !untagCopiesMutation.isPending) {
              setPendingTags(null)
              setBatchError(undefined)
            }
          }}
        />
      )}
    </main>
  )
}
