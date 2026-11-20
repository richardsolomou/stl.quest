import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react'
import { monitorForElements, type ElementEventPayloadMap } from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/extract-closest-edge'
import { useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { usePostHog } from '@posthog/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { SearchX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty'
import { requestQueueOrder, type BoardSort, type PrintGroup, type PrinterProfile, type PublicPrintRequest } from '../../core/types'
import { compareCompletedQueue, compareRequesterPriorityQueues, compareRoundRobinQueue } from '../../core/requestQueue'
import { printGroupPaths } from '../../core/printGroups'
import { printTypeCopy } from '../../core/printTypes'
import { copyDownloadIds } from '../../core/archive'
import { MAX_BULK_CARDS } from '../../core/request'
import type { StatusId, WorkflowDefinition } from '../../core/workflow'
import {
  archiveRequests,
  deleteRequest,
  deleteRequests,
  moveCopies,
  moveCopiesBatch,
  movePrintGroup,
  reorderRequest,
  reorderPrintGroupItem,
  repeatRequest,
  updatePrintCopyTags,
  updateRequest,
} from '../../server/fns'
import { boardCardKey, canDropOnColumn, canDropOnRequest, shouldSplitStackOnDrop } from '../boardDrag'
import { requestDownloadHref } from '../boardDownload'
import { errorMessage, isReportableMutationError } from '../../core/error'
import { boardEntriesByStatus, boardPrioritiesByStatus, boardRequestCohorts, boardTagCopyCounts } from '../boardEntries'
import {
  boardRequestState,
  deleteBoardOverride,
  moveBoardOverride,
  moveBoardOverrides,
  reconcileBoardOverrides,
  reorderBoardOverride,
  type BoardOverride,
} from '../boardOverrides'
import {
  boardBatchDeletions,
  boardBatchMoves,
  boardRequestSelected,
  boardSelectedCards,
  boardSelectedRequests,
  boardSelectedRequestIds,
  boardEditSelectionTags,
  boardSelectionEntries,
  boardSelectionTagState,
  boardTagItems,
  selectBoardColumn,
  selectBoardTag,
  selectBoardRequest,
  type BoardSelection,
  type BoardSelectionEntry,
} from '../boardSelection'
import { Column, type ZoneLayout } from './Column'
import { boardStations } from '../boardStations'
import { StationStrip } from './StationStrip'
import { AddPrintersLink, EmptyQueue, EmptyRail, EmptyShelf, EmptyStations } from './EmptyZone'
import { SelectionBar } from './SelectionBar'
import { StageJumpBar } from './StageJumpBar'
import { MoveDialog } from './MoveDialog'
import { BulkMoveDialog } from './BulkMoveDialog'
import { BulkDeleteDialog } from './BulkDeleteDialog'
import { useUsageTracking, useWorkspacePrintTypes, useWorkspaceSlug } from '../workspace'
import { signalProductTourProgress } from '../productTour'
import { removeRequestFromQueries, restoreRequestQueries } from '../queries'
import { RepeatRequestDialog } from './RepeatRequestDialog'
import { TagPickerDialog } from './TagPickerDialog'
import { StepUsageSheet } from './StepUsageSheet'
import { noteStepMoves, type StepMove } from '../stepUsage'
import { statusText } from '../../core/i18n'
import { useI18n } from '../i18n'

/** Dropping on the trailing edge of a card, below it in a list or right of it on the rail, places the dragged card after it. */
const afterEdges = new Set<string | null>(['bottom', 'right'])

type PendingMove = {
  requestId: string
  from: StatusId
  to?: StatusId
  destinations?: { id: StatusId; label: string }[]
  max: number
  /** The tags the moved card's copies carry. */
  tagIds: string[]
}
type PendingBatchMove = { to?: StatusId; destinations?: { id: StatusId; label: string }[] }
type PendingTags = { entries: BoardSelectionEntry[] }

export function Board({
  requests,
  groups,
  workflow,
  isAdmin,
  showRequesters,
  showPrintTypes,
  uploadsEnabled,
  filtered = false,
  selectedTagIds: filteredTagIds,
  sort,
  printers,
  onOpenRequest,
  onAddPrint,
}: {
  requests: PublicPrintRequest[]
  groups: PrintGroup[]
  workflow: WorkflowDefinition
  isAdmin: boolean
  showRequesters: boolean
  showPrintTypes: boolean
  uploadsEnabled: boolean
  filtered?: boolean
  selectedTagIds?: Set<string>
  sort: BoardSort
  printers: PrinterProfile[]
  onOpenRequest: (requestId: string) => void
  onAddPrint?: () => void
}) {
  const { t } = useI18n()
  const b = t.board.board
  const pass = t.board.pass
  const workspaceSlug = useWorkspaceSlug()
  const printTypes = useWorkspacePrintTypes()
  const posthog = usePostHog()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const callMoveCopies = useServerFn(moveCopies)
  const callMoveCopiesBatch = useServerFn(moveCopiesBatch)
  const callDeleteRequest = useServerFn(deleteRequest)
  const callDeleteRequests = useServerFn(deleteRequests)
  const callArchiveRequests = useServerFn(archiveRequests)
  const callUpdatePrintCopyTags = useServerFn(updatePrintCopyTags)
  const callMovePrintGroup = useServerFn(movePrintGroup)
  const callReorder = useServerFn(reorderRequest)
  const callReorderPrintGroupItem = useServerFn(reorderPrintGroupItem)
  const callRepeatRequest = useServerFn(repeatRequest)
  const callUpdateRequest = useServerFn(updateRequest)
  const refreshRequests = () => queryClient.invalidateQueries({ queryKey: ['requests', workspaceSlug] })
  const refreshAfterMutation = { onSuccess: refreshRequests }
  const moveMutation = useMutation({ mutationFn: callMoveCopies, ...refreshAfterMutation })
  const assignMutation = useMutation({ mutationFn: callUpdateRequest, ...refreshAfterMutation })
  const batchMoveMutation = useMutation({ mutationFn: callMoveCopiesBatch, ...refreshAfterMutation })
  const deleteMutation = useMutation({ mutationFn: callDeleteRequests, ...refreshAfterMutation })
  const deleteOwnedRequestMutation = useMutation({
    mutationFn: callDeleteRequest,
    onMutate: ({ data }) => removeRequestFromQueries(queryClient, workspaceSlug, data.id),
    onError: (_error, _variables, snapshots) => {
      if (snapshots) restoreRequestQueries(queryClient, snapshots)
    },
  })
  const archiveMutation = useMutation({
    mutationFn: callArchiveRequests,
    onMutate: async ({ data }) => {
      const snapshots = await Promise.all(data.ids.map((id) => removeRequestFromQueries(queryClient, workspaceSlug, id)))
      return snapshots.flat()
    },
    onSuccess: () => clearSelection(),
    onError: (error, _variables, snapshots) => {
      if (snapshots) restoreRequestQueries(queryClient, snapshots)
      if (isReportableMutationError(error)) posthog.captureException(error, { action: 'archive_request_batch' })
      toast.error(errorMessage(error, b.archiveFailed))
    },
  })
  const updateCopyTagsMutation = useMutation({ mutationFn: callUpdatePrintCopyTags, ...refreshAfterMutation })
  const movePrintGroupMutation = useMutation({ mutationFn: callMovePrintGroup, ...refreshAfterMutation })
  const reorderMutation = useMutation({ mutationFn: callReorder, ...refreshAfterMutation })
  const reorderGroupItemMutation = useMutation({ mutationFn: callReorderPrintGroupItem, ...refreshAfterMutation })
  const repeatMutation = useMutation({
    mutationFn: ({ requests: repeated, quantity }: { requests: PublicPrintRequest[]; quantity: number }) =>
      Promise.all(repeated.map((request) => callRepeatRequest({ data: { workspaceSlug, id: request.id, quantity } }))),
    ...refreshAfterMutation,
  })
  // Optimistic placement until the live query reflects it; clearing any
  // earlier (e.g. when the server fn resolves) makes copies flash back.
  const [overrides, setOverrides] = useState<Record<string, BoardOverride>>({})
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const [pendingBatchMove, setPendingBatchMove] = useState<PendingBatchMove | null>(null)
  const [batchMoveDialogPending, setBatchMoveDialogPending] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{
    requestId: string
    status: StatusId
    count: number
    tagIds: string[]
    wholeRequest: boolean
  }>()
  const [pendingTags, setPendingTags] = useState<PendingTags | null>(null)
  const [batchError, setBatchError] = useState<string>()
  const [selection, setSelection] = useState<BoardSelection | null>(null)
  const [repeatingRequests, setRepeatingRequests] = useState<PublicPrintRequest[]>([])
  const [settlingCardKeys, setSettlingCardKeys] = useState<Set<string>>(new Set())
  const [stepMoves, setStepMoves] = useState<StepMove[]>([])
  const lanesRef = useRef<HTMLDivElement>(null)
  const priorityStatus = workflow.statuses[0].id
  const completedStatus = workflow.statuses.at(-1)?.id
  const usageTracking = useUsageTracking()

  const clearSelection = useCallback(() => {
    setSelection(null)
    setPendingBatchMove(null)
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

  // Every move path reports here once the server has moved the copies, so each one asks what was used the same way.
  const noteMoved = useCallback(
    (moved: Parameters<typeof noteStepMoves>[2]) => {
      if (moved.some(({ to }) => to === completedStatus)) signalProductTourProgress('move')
      if (isAdmin && usageTracking) setStepMoves((current) => noteStepMoves(current, workflow.statuses, moved))
    },
    [completedStatus, isAdmin, usageTracking, workflow.statuses],
  )
  const closeStepUsage = useCallback(() => setStepMoves([]), [])

  const revertOverride = useCallback((requestId: string) => {
    setOverrides((prev) => {
      const { [requestId]: _dropped, ...rest } = prev
      return rest
    })
  }, [])

  const performMove = useCallback(
    (requestId: string, from: StatusId, to: StatusId, count: number, tagIds: string[], printerId?: string) => {
      const request = requests.find((j) => j.id === requestId)
      if (!request) return
      setOverrides((current) => ({
        ...current,
        [requestId]: moveBoardOverride(request, current[requestId], from, to, count, tagIds, completedStatus),
      }))
      moveMutation.mutate(
        { data: { workspaceSlug, id: requestId, from, to, count, tagIds } },
        {
          onSuccess: () => noteMoved([{ id: requestId, from, to, count, printerId }]),
          onError: (error) => {
            if (isReportableMutationError(error))
              posthog.captureException(error, { action: 'move_request_copies', print_type: request.printType, from, to, count })
            revertOverride(requestId)
          },
        },
      )
    },
    [requests, completedStatus, moveMutation, noteMoved, revertOverride, posthog, workspaceSlug],
  )

  // Starting on a picked printer assigns the print to it first, so the station it lands on is the one the operator chose.
  const startOn = useCallback(
    async (requestId: string, from: StatusId, count: number, tagIds: string[], printerId: string) => {
      const request = requests.find((candidate) => candidate.id === requestId)
      if (!request) return
      if (request.printer?.id !== printerId) {
        try {
          await assignMutation.mutateAsync({ data: { workspaceSlug, id: requestId, printerId } })
        } catch (error) {
          if (isReportableMutationError(error))
            posthog.captureException(error, { action: 'assign_printer_on_start', print_type: request.printType })
          toast.error(errorMessage(error, pass.assignFailed))
          return
        }
      }
      performMove(requestId, from, 'in_progress', count, tagIds, printerId)
    },
    [assignMutation, pass.assignFailed, performMove, posthog, requests, workspaceSlug],
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
    return boardSelectionEntries(requests, selection, countsOf, groupsOf)
  }, [countsOf, groupsOf, requests, selection])
  const selectedRequests = useMemo(() => boardSelectedRequests(selectedEntries), [selectedEntries])
  const pendingTagState = useMemo(() => boardSelectionTagState(pendingTags?.entries ?? []), [pendingTags])
  const canDeleteSelectedRequests = selectedRequests.length > 0 && selectedRequests.every((request) => request.canDelete)
  const canArchiveSelectedRequests = selectedRequests.length > 0 && selectedRequests.every((request) => request.canArchive)
  const canRepeatSelectedRequests = selectedRequests.length > 0 && (isAdmin || selectedRequests.every((request) => request.mine))
  const canDownloadSelectedRequests = selectedRequests.length > 0 && selectedRequests.every((request) => request.hasFile)
  const selectedCopies = useMemo(() => {
    const copies = new Map<string, number>()
    for (const { request, max } of selectedEntries) copies.set(request.id, (copies.get(request.id) ?? 0) + max)
    return [...copies].map(([id, count]) => ({ id, copies: count }))
  }, [selectedEntries])
  const selectionCopyDownloadCount = copyDownloadIds(selectedCopies)?.length
  // Keep a stable identity while the selection is unchanged. A fresh array each render makes
  // every selected card re-register its drag handlers, which drops clicks on the open card menu.
  const selectionRequestIds = useMemo(() => [...boardSelectedRequestIds(selection)], [selection])
  const adjustableEntries = useMemo(() => selectedEntries.filter(({ max }) => max > 1), [selectedEntries])
  const selectedStatuses = useMemo(() => new Set(selectedEntries.map(({ status }) => status)), [selectedEntries])
  const batchDestinations = useMemo(
    () =>
      selection
        ? workflow.statuses
            .filter((status) => [...selectedStatuses].every((from) => canDropOnColumn(from, status.id)))
            .map((status) => ({ id: status.id, label: statusText(t, 'label', status.id) }))
        : [],
    [selection, selectedStatuses, t, workflow.statuses],
  )

  const moveSelected = async (destination: StatusId, counts: Record<string, number>) => {
    if (!selection || selectedEntries.length === 0) return
    setBatchError(undefined)
    const moves = boardBatchMoves(selectedEntries, destination, counts)
    const requestsById = new Map(selectedEntries.map(({ request }) => [request.id, request]))
    let previousOverrides = new Map<string, BoardOverride | undefined>()
    let optimisticOverrides: Record<string, BoardOverride> | undefined
    setOverrides((current) => {
      previousOverrides = new Map(moves.map(({ id }) => [id, current[id]]))
      optimisticOverrides = moveBoardOverrides(
        current,
        moves.map(({ id, from, count, tagIds }) => ({ request: requestsById.get(id)!, from, to: destination, count, tagIds })),
        completedStatus,
      )
      return optimisticOverrides
    })
    try {
      await batchMoveMutation.mutateAsync({ data: { workspaceSlug, moves } })
      noteMoved(moves)
      clearSelection()
    } catch (error) {
      setOverrides((current) => {
        const next = { ...current }
        for (const [requestId, previous] of previousOverrides) {
          if (current[requestId] !== optimisticOverrides?.[requestId]) continue
          if (previous) next[requestId] = previous
          else delete next[requestId]
        }
        return next
      })
      if (isReportableMutationError(error)) posthog.captureException(error, { action: 'move_request_batch' })
      setBatchError(errorMessage(error, b.moveGroupFailed))
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
      setBatchMoveDialogPending(false)
      setPendingBatchMove({ to, destinations: to ? undefined : batchDestinations })
    }
  }

  /** Downloads one file per id, so a repeated id downloads that model once per copy. */
  const downloadRequests = (ids: string[]) => {
    const targets = ids.map((id) => requests.find((request) => request.id === id)).filter((request) => request !== undefined)
    if (!targets.length) return
    const link = document.createElement('a')
    link.href = requestDownloadHref(targets)
    link.download = ''
    // Firefox and Safari ignore a click on an anchor that is not in the document.
    document.body.append(link)
    link.click()
    link.remove()
    const modelCount = new Set(ids).size
    // The browser only shows a download once the archive starts streaming, which takes a moment for large batches.
    if (targets.length > 1)
      toast(b.zipping(targets.length, targets.length > modelCount), {
        description: b.zippingDescription,
      })
    const properties =
      ids.length === 1
        ? { print_type: requests.find(({ id }) => id === ids[0])?.printType }
        : { request_count: modelCount, file_count: ids.length }
    posthog.capture(ids.length === 1 ? 'stl_downloaded' : 'stl_batch_downloaded', properties)
    signalProductTourProgress('download')
  }

  const settle = (requestId: string, status: StatusId) => {
    const settlingCardKey = boardCardKey(requestId, status)
    setSettlingCardKeys((current) => new Set(current).add(settlingCardKey))
    window.setTimeout(() => setSettlingCardKeys((current) => new Set([...current].filter((key) => key !== settlingCardKey))), 340)
  }

  const handleDrop = useEffectEvent(({ source, location }: ElementEventPayloadMap['onDrop']) => {
    const requestId = source.data.requestId
    const from = source.data.from as StatusId
    const fromGroupId = typeof source.data.groupId === 'string' ? source.data.groupId : undefined
    const tagIds = Array.isArray(source.data.tagIds) ? source.data.tagIds.filter((id): id is string => typeof id === 'string') : []
    const draggingSelection = source.data.selected === true
    if (source.data.type === 'print-group') {
      const target = location.current.dropTargets.find((candidate) => candidate.data.type === 'column')
      const to = target?.data.status as StatusId | undefined
      if (!isAdmin || !fromGroupId || !to || !canDropOnColumn(from, to)) return
      const items = groups.find((group) => group.id === fromGroupId)?.items.filter((item) => item.status === from) ?? []
      movePrintGroupMutation.mutate(
        { data: { workspaceSlug, id: fromGroupId, from, to } },
        { onSuccess: () => noteMoved(items.map((item) => ({ id: item.requestId, from, to, count: item.count }))) },
      )
      return
    }
    const cardTarget = location.current.dropTargets.find((candidate) => candidate.data.type === 'card')
    const target =
      (fromGroupId && cardTarget?.data.groupId === fromGroupId ? cardTarget : undefined) ??
      (fromGroupId ? location.current.dropTargets.find((candidate) => candidate.data.type === 'column') : undefined) ??
      location.current.dropTargets[0]
    if (typeof requestId !== 'string' || !target) return
    settle(requestId, typeof target.data.status === 'string' ? target.data.status : from)

    const sourceRequest = requests.find((request) => request.id === requestId)
    if (!sourceRequest) return
    const count = typeof source.data.count === 'number' ? source.data.count : undefined
    const splitStack = source.data.splitStack === true || shouldSplitStackOnDrop(location.current.input)
    if (target.data.type === 'card' && target.data.status === from && fromGroupId && target.data.groupId === fromGroupId) {
      const targetRequestId = target.data.requestId
      if (!isAdmin || typeof targetRequestId !== 'string' || targetRequestId === requestId) return
      reorderGroupItemMutation.mutate({
        data: {
          workspaceSlug,
          groupId: fromGroupId,
          status: from,
          requestId,
          targetRequestId,
          edge: afterEdges.has(extractClosestEdge(target.data)) ? 'after' : 'before',
        },
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
          const before = afterEdges.has(edge) ? list[index] : list[index - 1]
          const after = afterEdges.has(edge) ? list[index + 1] : list[index]
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
    if (draggingSelection) {
      openBatchMove(to, splitStack)
      return
    }
    const available = Math.min(count ?? Infinity, countsOf(sourceRequest)[from], sourceRequest.counts[from])
    if (available <= 0) return
    // A drop anywhere on a printer's station, its job cards included, picks that printer.
    const stationPrinterId = location.current.dropTargets.find((candidate) => typeof candidate.data.printerId === 'string')?.data.printerId
    if (to === 'in_progress' && typeof stationPrinterId === 'string' && (available === 1 || !splitStack))
      void startOn(requestId, from, available, tagIds, stationPrinterId)
    else if (available === 1 || !splitStack) performMove(requestId, from, to, available, tagIds)
    else setPendingMove({ requestId, from, to, max: available, tagIds })
  })

  useEffect(() => monitorForElements({ onDrop: handleDrop }), [])

  const pendingRequest = pendingMove ? requests.find((j) => j.id === pendingMove.requestId) : undefined
  const pendingDeleteRequest = pendingDelete ? requests.find((request) => request.id === pendingDelete.requestId) : undefined
  const reorderEnabled = sort === 'fair'
  const statusEntries = useMemo(
    () => boardEntriesByStatus(requests, groups, workflow.statuses, countsOf, groupsOf, compare, filteredTagIds),
    [groups, compare, countsOf, filteredTagIds, groupsOf, requests, workflow.statuses],
  )
  const tagPaths = useMemo(() => printGroupPaths(groups), [groups])
  const tagCopyCounts = useMemo(() => boardTagCopyCounts(groups), [groups])
  const selectTag = (status: StatusId, tagId: string) => {
    setSelection(selectBoardTag(requests, status, tagId))
  }
  if (filtered && requests.length === 0) {
    return (
      <Empty className="min-h-0 p-6">
        <EmptyHeader className="max-w-md">
          <EmptyMedia variant="icon">
            <SearchX aria-hidden="true" />
          </EmptyMedia>
          <h2 className="font-heading text-xl font-extrabold uppercase">{b.filteredEmptyTitle}</h2>
          <EmptyDescription>{b.filteredEmptyHint}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const entriesOf = (status: StatusId) => statusEntries.get(status)?.entries ?? []
  const totalOf = (status: StatusId) => statusEntries.get(status)?.total ?? 0
  const stations = boardStations(printers, entriesOf('in_progress'), entriesOf('up_next'))
  const idlePrinters = stations.filter((station) => station.printer && station.entries.length === 0).length
  const readyPeople = new Set(entriesOf('done').map(({ request }) => request.requesterId)).size
  const advanceTargets = new Map(
    workflow.statuses
      .slice(0, -1)
      .map((status, index) => [status.id, workflow.statuses[index + 1].id] as const)
      .filter(([from, to]) => canDropOnColumn(from, to)),
  )

  const archiveSelection = () => {
    const ids = [...new Set(selectedRequests.filter((request) => request.canArchive).map(({ id }) => id))]
    for (let index = 0; index < ids.length; index += 100) {
      archiveMutation.mutate({ data: { workspaceSlug, ids: ids.slice(index, index + 100) } })
    }
  }

  // Each empty zone says what lands there, in the operator's or the member's terms; only admins get setup prompts.
  const empty = t.board.zoneEmpty
  const role = isAdmin ? 'admin' : 'member'
  const firstLabel = statusText(t, 'label', workflow.statuses[0].id)
  const lastLabel = statusText(t, 'label', workflow.statuses.at(-1)?.id ?? workflow.statuses[0].id)
  const welcome = requests.length === 0
  const emptyZones: Partial<Record<StatusId, ReactNode>> = {
    todo: (
      <EmptyQueue
        title={welcome ? (isAdmin ? b.emptyTitle : empty.memberTitle) : undefined}
        hint={
          !welcome
            ? empty.queue[role]
            : !isAdmin
              ? empty.memberWelcome(firstLabel, lastLabel)
              : uploadsEnabled
                ? b.emptyUploadHint(firstLabel, lastLabel)
                : b.emptyLinkHint
        }
        addLabel={t.board.page.addPrint}
        onAdd={onAddPrint}
        invite={isAdmin ? empty.invite : undefined}
      />
    ),
    up_next: <EmptyRail hint={empty.upNext[role]} nudge={isAdmin && entriesOf('todo').length > 0 ? empty.upNextNudge : undefined} />,
    in_progress: (
      <EmptyStations
        fleet={stations.length > 0}
        hint={stations.length > 0 || !isAdmin ? empty.printing[role] : empty.noPrinters}
        action={isAdmin && stations.length === 0 ? <AddPrintersLink label={empty.addPrinters} /> : undefined}
      />
    ),
    post_processing: <EmptyShelf hint={empty.finishing[printTypeCopy(printTypes)]} />,
    done: <EmptyShelf hint={empty.ready[role]} />,
  }

  const zone = (status: StatusId, layout: ZoneLayout, detail?: string) => {
    const definition = workflow.statuses.find((candidate) => candidate.id === status)
    if (!definition) return null
    return (
      <Column
        status={status}
        layout={layout}
        detail={detail}
        empty={emptyZones[status]}
        entries={entriesOf(status)}
        stations={layout === 'stations' || advanceTargets.get(status) === 'in_progress' ? stations : undefined}
        total={totalOf(status)}
        onSelectAll={() =>
          setSelection(
            selectBoardColumn(
              entriesOf(status).map(({ request }) => request.id),
              status,
            ),
          )
        }
        groupShelfByRequester={status === completedStatus && showRequesters}
        countsOf={countsOf}
        advanceTo={advanceTargets.get(status)}
        tagPaths={tagPaths}
        tagCopyCounts={tagCopyCounts}
        isAdmin={isAdmin}
        showRequesters={showRequesters}
        reorderEnabled={reorderEnabled && status === priorityStatus}
        showPrintType={showPrintTypes}
        filtered={filtered}
        settlingCardKeys={settlingCardKeys}
        selectionMode={selection !== null}
        selection={selection}
        selectedRequestIds={selectionRequestIds}
        canDeleteSelection={canDeleteSelectedRequests}
        canArchiveSelection={canArchiveSelectedRequests}
        canRepeatSelection={canRepeatSelectedRequests}
        canDownloadSelection={canDownloadSelectedRequests}
        selectionCopyDownloadCount={selectionCopyDownloadCount}
        onOpenRequest={onOpenRequest}
        onAdvanceRequest={
          isAdmin
            ? (requestId, from, to, count, tagIds) => {
                settle(requestId, to)
                performMove(requestId, from, to, count, tagIds)
              }
            : undefined
        }
        onStartRequest={
          isAdmin
            ? (requestId, from, count, tagIds, printerId) => {
                settle(requestId, 'in_progress')
                void startOn(requestId, from, count, tagIds, printerId)
              }
            : undefined
        }
        onMoveRequest={
          isAdmin
            ? (requestId, from, count, groupId, tagIds, cohortId) => {
                if (boardRequestSelected(selection, from, requestId, groupId, cohortId)) {
                  openBatchMove()
                  return
                }
                setPendingMove({
                  requestId,
                  from,
                  destinations: workflow.statuses
                    .filter((candidate) => canDropOnColumn(from, candidate.id))
                    .map((candidate) => ({ id: candidate.id, label: statusText(t, 'label', candidate.id) })),
                  max: count,
                  tagIds,
                })
              }
            : undefined
        }
        onDownloadRequest={(requestId, cardStatus, count, perCopy, groupId, cohortId) => {
          const models = boardRequestSelected(selection, cardStatus, requestId, groupId, cohortId)
            ? selectedCopies
            : [{ id: requestId, copies: count }]
          downloadRequests((perCopy && copyDownloadIds(models)) || models.map(({ id }) => id))
        }}
        onRepeatRequest={(request, cardStatus, groupId, cohortId) => {
          const selected = boardRequestSelected(selection, cardStatus, request.id, groupId, cohortId)
          setRepeatingRequests(selected ? selectedRequests : [request])
        }}
        onDeleteRequest={(requestId, cardStatus, count, groupId, tagIds, cohortId) => {
          if (boardRequestSelected(selection, cardStatus, requestId, groupId, cohortId)) {
            setConfirmDelete(true)
            return
          }
          const request = requests.find((candidate) => candidate.id === requestId)
          setPendingDelete({
            requestId,
            status: cardStatus,
            count: isAdmin ? count : (request?.quantity ?? count),
            tagIds,
            wholeRequest: !isAdmin,
          })
        }}
        onArchiveRequest={(requestId, cardStatus, groupId, cohortId) => {
          if (!boardRequestSelected(selection, cardStatus, requestId, groupId, cohortId)) {
            archiveMutation.mutate({ data: { workspaceSlug, ids: [requestId] } })
            return
          }
          archiveSelection()
        }}
        onManageTags={(requestId, groupStatus, count, tagIds, groupId, cohortId) => {
          const request = requests.find((candidate) => candidate.id === requestId)
          if (boardRequestSelected(selection, groupStatus, requestId, groupId, cohortId)) {
            setPendingTags({ entries: selectedEntries })
          } else if (request) {
            setPendingTags({
              entries: [{ request, status: groupStatus, cohorts: [{ key: cohortId, count, tagIds }], max: count }],
            })
          }
          clearSelection()
        }}
        onSelectRequest={(columnStatus, requestId, orderedIds, options, groupId, cohortId) => {
          const request = requests.find((candidate) => candidate.id === requestId)
          const cards = request
            ? boardRequestCohorts({ ...request, groups: groupsOf(request) }, columnStatus, countsOf(request)[columnStatus]).map((card) => ({
                key: card.key,
                tagIds: card.request.groups.map((tag) => tag.id),
              }))
            : []
          setSelection((current) => selectBoardRequest(current, columnStatus, orderedIds, requestId, options, groupId, cohortId, cards))
        }}
        onSelectTag={selectTag}
      />
    )
  }

  return (
    <section
      className="board relative flex min-h-0 flex-1 flex-col overflow-hidden @container"
      onPointerDown={(event) => {
        if (!selection) return
        const target = event.target as Element
        if (!target.closest('.board')) return
        if (!target.closest('.card,button,input,[role="dialog"],[data-selection-controls]')) clearSelection()
      }}
    >
      <StageJumpBar
        lanes={lanesRef}
        className="@min-[960px]:hidden"
        stages={workflow.statuses.map(({ id }) => ({ id, label: statusText(t, 'label', id), total: totalOf(id) }))}
      />
      {/* The side columns keep their laptop width and widen only on large screens, so the centre column is never squeezed. */}
      <div
        ref={lanesRef}
        className="grid min-h-0 flex-1 gap-4 p-3 @max-[959px]:snap-x @max-[959px]:snap-mandatory @max-[959px]:scroll-px-3 @max-[959px]:auto-cols-[min(86cqw,24rem)] @max-[959px]:grid-flow-col @max-[959px]:overflow-x-auto @min-[960px]:grid-cols-[minmax(14rem,clamp(17rem,22cqw,21rem))_minmax(22rem,1fr)_minmax(13rem,clamp(15rem,20cqw,19rem))]"
      >
        {zone('todo', 'list', pass.queueDetail(new Set(entriesOf('todo').map(({ request }) => request.id)).size))}
        <div className="app-scrollbar flex min-h-0 min-w-0 flex-col gap-4 overflow-x-hidden overflow-y-auto overscroll-y-contain @max-[959px]:contents">
          <StationStrip stations={stations} className={cn('hidden @min-[960px]:flex', stations.length <= 4 && '@min-[1400px]:hidden')} />
          {zone('up_next', 'rail', pass.upNextDetail)}
          {zone('in_progress', 'stations', pass.stationsDetail(stations.filter(({ printer }) => printer).length, idlePrinters))}
        </div>
        {/* Finishing and ready each hold half the column, so neither shelf's height depends on what the other holds. */}
        <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-4 @max-[959px]:contents">
          {zone('post_processing', 'shelf')}
          {zone('done', 'shelf', showRequesters && readyPeople ? pass.shelfDetail(readyPeople) : undefined)}
        </div>
      </div>
      {selection && selectedEntries.length > 0 && (
        <SelectionBar
          prints={selectedRequests.length}
          copies={selectedCopies.reduce((sum, { copies }) => sum + copies, 0)}
          move={isAdmin && batchDestinations.length > 0 ? { onClick: () => openBatchMove() } : undefined}
          tags={isAdmin ? { onClick: () => setPendingTags({ entries: selectedEntries }) } : undefined}
          download={canDownloadSelectedRequests ? { onClick: () => downloadRequests(selectedCopies.map(({ id }) => id)) } : undefined}
          repeat={canRepeatSelectedRequests ? { onClick: () => setRepeatingRequests(selectedRequests) } : undefined}
          estimate={
            isAdmin
              ? {
                  onClick: () => void navigate({ to: '/calculator', search: { requests: selectedRequests.map(({ id }) => id).join(',') } }),
                }
              : undefined
          }
          archive={canArchiveSelectedRequests ? { onClick: archiveSelection } : undefined}
          remove={canDeleteSelectedRequests ? { onClick: () => setConfirmDelete(true) } : undefined}
          overLimit={selectedEntries.length > MAX_BULK_CARDS}
          onClear={clearSelection}
        />
      )}
      {stepMoves.length > 0 && (
        <StepUsageSheet
          moves={stepMoves}
          requests={requests}
          printers={printers}
          raised={selection !== null && selectedEntries.length > 0}
          onDone={closeStepUsage}
        />
      )}
      {pendingMove && pendingRequest && (
        <MoveDialog
          requestName={pendingRequest.name}
          toLabel={pendingMove.to ? statusText(t, 'label', pendingMove.to) : undefined}
          destinations={pendingMove.destinations}
          max={pendingMove.max}
          onConfirm={(count, selectedDestination) => {
            const to = pendingMove.to ?? selectedDestination
            if (!to) return
            performMove(pendingMove.requestId, pendingMove.from, to, count, pendingMove.tagIds)
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
          error={repeatMutation.error ? errorMessage(repeatMutation.error, b.repeatFailed) : undefined}
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
      {pendingBatchMove && selection && selectedEntries.length > 0 && (
        <BulkMoveDialog
          entries={adjustableEntries}
          requestCount={selectedEntries.length}
          destination={pendingBatchMove.to}
          destinations={pendingBatchMove.destinations}
          pending={batchMoveDialogPending}
          error={batchError}
          onConfirm={(counts, destination) => {
            setBatchMoveDialogPending(true)
            void moveSelected(destination, counts).finally(() => setBatchMoveDialogPending(false))
          }}
          onCancel={() => {
            if (!batchMoveDialogPending) {
              setPendingBatchMove(null)
              setBatchError(undefined)
            }
          }}
        />
      )}
      {confirmDelete && selection && selectedEntries.length > 0 && (
        <BulkDeleteDialog
          entries={
            isAdmin ? boardSelectedCards(selectedEntries) : selectedRequests.map((request) => ({ request, count: request.quantity }))
          }
          confirmLabel={isAdmin ? undefined : b.deleteRequests}
          pending={deleteMutation.isPending || deleteOwnedRequestMutation.isPending}
          error={batchError}
          onConfirm={async () => {
            setBatchError(undefined)
            try {
              if (isAdmin) {
                await deleteMutation.mutateAsync({
                  data: {
                    workspaceSlug,
                    deletions: boardBatchDeletions(selectedEntries),
                  },
                })
              } else {
                await Promise.all(
                  selectedRequests.map((request) => deleteOwnedRequestMutation.mutateAsync({ data: { workspaceSlug, id: request.id } })),
                )
              }
              clearSelection()
            } catch (error) {
              if (isReportableMutationError(error)) posthog.captureException(error, { action: 'delete_request_batch' })
              setBatchError(errorMessage(error, undefined))
            }
          }}
          onCancel={() => {
            if (!deleteMutation.isPending && !deleteOwnedRequestMutation.isPending) {
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
          title={
            pendingDelete.wholeRequest
              ? b.deleteRequestTitle(pendingDeleteRequest.name)
              : b.deleteCopiesTitle(pendingDelete.count, pendingDeleteRequest.name)
          }
          confirmLabel={pendingDelete.wholeRequest ? b.deleteRequest : undefined}
          pending={deleteMutation.isPending || deleteOwnedRequestMutation.isPending}
          error={batchError}
          onConfirm={async () => {
            setBatchError(undefined)
            if (pendingDelete.wholeRequest) {
              setPendingDelete(undefined)
              try {
                await deleteOwnedRequestMutation.mutateAsync({ data: { workspaceSlug, id: pendingDeleteRequest.id } })
              } catch (error) {
                setPendingDelete(pendingDelete)
                if (isReportableMutationError(error)) posthog.captureException(error, { action: 'delete_request' })
                setBatchError(errorMessage(error, undefined))
              }
              return
            }
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
                  deletions: [
                    {
                      id: pendingDeleteRequest.id,
                      status: pendingDelete.status,
                      count: pendingDelete.count,
                      ...(pendingDelete.tagIds.length ? { tagIds: pendingDelete.tagIds } : {}),
                    },
                  ],
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
            if (!deleteMutation.isPending && !deleteOwnedRequestMutation.isPending) {
              setPendingDelete(undefined)
              setBatchError(undefined)
            }
          }}
        />
      )}
      {pendingTags && (
        <TagPickerDialog
          tags={groups}
          selectedTagIds={pendingTagState.all}
          partialTagIds={pendingTagState.some}
          pending={updateCopyTagsMutation.isPending}
          error={batchError}
          onToggle={async (groupId, selected) => {
            setBatchError(undefined)
            try {
              await updateCopyTagsMutation.mutateAsync({
                data: {
                  workspaceSlug,
                  addTagIds: selected ? [groupId] : [],
                  removeTagIds: selected ? [] : [groupId],
                  items: boardTagItems(pendingTags.entries, { tagId: groupId, selected }),
                },
              })
              setPendingTags((current) => current && { entries: boardEditSelectionTags(current.entries, groupId, selected) })
            } catch (error) {
              setBatchError(errorMessage(error, b.tagsUpdateFailed))
            }
          }}
          onCreate={async (name) => {
            setBatchError(undefined)
            try {
              const groupId = await updateCopyTagsMutation.mutateAsync({
                data: { workspaceSlug, createTagName: name, addTagIds: [], removeTagIds: [], items: boardTagItems(pendingTags.entries) },
              })
              if (!groupId) return
              setPendingTags((current) => current && { entries: boardEditSelectionTags(current.entries, groupId, true) })
            } catch (error) {
              setBatchError(errorMessage(error, b.tagCreateFailed))
            }
          }}
          onCancel={() => {
            if (!updateCopyTagsMutation.isPending) {
              setPendingTags(null)
              setBatchError(undefined)
            }
          }}
        />
      )}
    </section>
  )
}
