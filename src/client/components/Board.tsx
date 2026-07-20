import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react'
import { monitorForElements, type ElementEventPayloadMap } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { useServerFn } from '@tanstack/react-start'
import { usePostHog } from '@posthog/react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { requestQueueOrder, type BoardSort, type PublicPrintRequest } from '../../core/types'
import { compareRequesterPriorityQueues, compareRoundRobinQueue, requesterQueuePriorities } from '../../core/requestQueue'
import type { StatusId, WorkflowDefinition } from '../../core/workflow'
import { deleteRequests, moveCopies, moveCopiesBatch, reorderRequest } from '../../server/fns'
import { canDropOnColumn, canDropOnRequest } from '../boardDrag'
import { selectBoardRequest, type BoardSelection } from '../boardSelection'
import { Column } from './Column'
import { MoveDialog } from './MoveDialog'
import { BulkMoveDialog } from './BulkMoveDialog'
import { BulkDeleteDialog } from './BulkDeleteDialog'
import { useWorkspaceSlug } from '../workspace'

type Override = { counts: PublicPrintRequest['counts']; orders: PublicPrintRequest['orders'] }
type PendingMove = {
  requestId: string
  from: StatusId
  to?: StatusId
  destinations?: { id: StatusId; label: string }[]
  max: number
}
type PendingBatchMove = { from: StatusId; to?: StatusId; destinations?: { id: StatusId; label: string }[] }

export function Board({
  requests,
  workflow,
  isAdmin,
  showPrintTypes,
  filtered = false,
  sort,
  onOpenRequest,
}: {
  requests: PublicPrintRequest[]
  workflow: WorkflowDefinition
  isAdmin: boolean
  showPrintTypes: boolean
  filtered?: boolean
  sort: BoardSort
  onOpenRequest: (requestId: string) => void
}) {
  const workspaceSlug = useWorkspaceSlug()
  const posthog = usePostHog()
  const callMoveCopies = useServerFn(moveCopies)
  const callMoveCopiesBatch = useServerFn(moveCopiesBatch)
  const callDeleteRequests = useServerFn(deleteRequests)
  const callReorder = useServerFn(reorderRequest)
  const moveMutation = useMutation({ mutationFn: callMoveCopies })
  const batchMoveMutation = useMutation({ mutationFn: callMoveCopiesBatch })
  const deleteMutation = useMutation({ mutationFn: callDeleteRequests })
  const reorderMutation = useMutation({ mutationFn: callReorder })
  // Optimistic placement until the live query reflects it; clearing any
  // earlier (e.g. when the server fn resolves) makes copies flash back.
  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const [pendingBatchMove, setPendingBatchMove] = useState<PendingBatchMove | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [batchError, setBatchError] = useState<string>()
  const [selection, setSelection] = useState<BoardSelection | null>(null)
  const [settlingIds, setSettlingIds] = useState<Set<string>>(new Set())
  const priorityStatus = workflow.statuses[0]?.id

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

  const countsOf = useCallback((request: PublicPrintRequest) => overrides[request.id]?.counts ?? request.counts, [overrides])
  const ordersOf = useCallback((request: PublicPrintRequest) => overrides[request.id]?.orders ?? request.orders, [overrides])
  const sortKey = useCallback(
    (request: PublicPrintRequest, status: StatusId) =>
      requestQueueOrder({ orders: ordersOf(request), createdAt: request.createdAt }, status),
    [ordersOf],
  )
  const boardPriorities = useMemo(() => {
    const current = requests.map((request) => ({ ...request, orders: overrides[request.id]?.orders ?? request.orders }))
    return new Map(
      workflow.statuses.map((status) => [
        status.id,
        requesterQueuePriorities(
          current.filter((request) => (overrides[request.id]?.counts ?? request.counts)[status.id] > 0),
          status.id,
        ),
      ]),
    )
  }, [overrides, requests, workflow.statuses])
  const serverRank = useMemo(() => new Map(requests.map((request, index) => [request.id, index])), [requests])
  const compare = useCallback(
    (left: PublicPrintRequest, right: PublicPrintRequest, status: StatusId) =>
      sort === 'fair'
        ? compareRequesterPriorityQueues(left, right, boardPriorities.get(status) ?? new Map())
        : sort === 'round-robin'
          ? compareRoundRobinQueue(left, right, boardPriorities.get(status) ?? new Map())
          : (serverRank.get(left.id) ?? 0) - (serverRank.get(right.id) ?? 0),
    [boardPriorities, serverRank, sort],
  )

  useEffect(() => {
    setOverrides((prev) => {
      const next = { ...prev }
      let changed = false
      for (const [id, override] of Object.entries(prev)) {
        const request = requests.find((j) => j.id === id)
        const settled =
          !request ||
          (JSON.stringify(request.counts) === JSON.stringify(override.counts) &&
            JSON.stringify(request.orders) === JSON.stringify(override.orders))
        if (settled) {
          delete next[id]
          changed = true
        }
      }
      return changed ? next : prev
    })
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
      const counts = countsOf(request)
      const nextCounts = { ...counts, [from]: counts[from] - count, [to]: counts[to] + count }
      const currentOrders = ordersOf(request)
      const nextOrders = counts[to] > 0 ? currentOrders : { ...currentOrders, [to]: currentOrders[from] }
      setOverrides((prev) => ({ ...prev, [requestId]: { counts: nextCounts, orders: nextOrders } }))
      moveMutation.mutate(
        { data: { workspaceSlug, id: requestId, from, to, count } },
        {
          onError: (error) => {
            posthog.captureException(error, { action: 'move_request_copies', print_type: request.printType, from, to, count })
            revertOverride(requestId)
          },
        },
      )
    },
    [requests, countsOf, ordersOf, moveMutation, revertOverride, posthog, workspaceSlug],
  )

  const performReorder = useCallback(
    (requestId: string, status: StatusId, order: number) => {
      const request = requests.find((j) => j.id === requestId)
      if (!request) return
      const nextOrders = { ...ordersOf(request), [status]: order }
      setOverrides((prev) => ({ ...prev, [requestId]: { counts: countsOf(request), orders: nextOrders } }))
      reorderMutation.mutate(
        { data: { workspaceSlug, id: requestId, status, order } },
        {
          onError: (error) => {
            posthog.captureException(error, { action: 'reorder_request', print_type: request.printType, status })
            revertOverride(requestId)
          },
        },
      )
    },
    [requests, countsOf, ordersOf, reorderMutation, revertOverride, posthog, workspaceSlug],
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
    if (!selection) return []
    return requests
      .filter((request) => selection.ids.has(request.id) && countsOf(request)[selection.status] > 0)
      .map((request) => ({ request, max: countsOf(request)[selection.status] }))
  }, [countsOf, requests, selection])

  const openBatchMove = useCallback(
    (to?: StatusId) => {
      if (!selection || selectedEntries.length === 0) return
      const destinations = workflow.statuses
        .filter((status) => canDropOnColumn(selection.status, status.id))
        .map((status) => ({ id: status.id, label: status.label }))
      if (to || destinations.length > 0) {
        setBatchError(undefined)
        setPendingBatchMove({ from: selection.status, to, destinations: to ? undefined : destinations })
      }
    },
    [selectedEntries.length, selection, workflow.statuses],
  )

  const handleDrop = useEffectEvent(({ source, location }: ElementEventPayloadMap['onDrop']) => {
    const requestId = source.data.requestId
    const from = source.data.from as StatusId
    const selectedRequestIds = Array.isArray(source.data.selectedRequestIds)
      ? source.data.selectedRequestIds.filter((id): id is string => typeof id === 'string')
      : []
    const target = location.current.dropTargets[0]
    if (typeof requestId !== 'string' || !target) return
    setSettlingIds((current) => new Set(current).add(requestId))
    window.setTimeout(() => setSettlingIds((current) => new Set([...current].filter((id) => id !== requestId))), 260)

    const sourceRequest = requests.find((request) => request.id === requestId)
    if (!sourceRequest) return
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
    const available = countsOf(request)[from]
    if (available <= 0) return
    if (available === 1) performMove(requestId, from, to, 1)
    else setPendingMove({ requestId, from, to, max: available })
  })

  useEffect(() => monitorForElements({ onDrop: handleDrop }), [])

  const pendingRequest = pendingMove ? requests.find((j) => j.id === pendingMove.requestId) : undefined
  const reorderEnabled = sort === 'fair'

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
              : 'Add a private STL request to start tracking copies from Queue through Up next, Printing, Finishing, and Ready.'}
          </p>
        </div>
      </main>
    )
  }

  return (
    <main
      className="board grid min-h-0 flex-1 grid-flow-col grid-cols-none auto-cols-[minmax(280px,1fr)] gap-3 overflow-x-auto p-3 max-[900px]:auto-cols-[82%]"
      onPointerDown={(event) => {
        if (!selection) return
        const target = event.target as Element
        if (!target.closest('.board')) return
        if (!target.closest('.card,button,input,[role="dialog"],[data-selection-controls]')) clearSelection()
      }}
    >
      {workflow.statuses.map((definition) => {
        const status = definition.id
        return (
          <Column
            key={status}
            status={status}
            definition={definition}
            entries={requests
              .filter((request) => countsOf(request)[status] > 0)
              .sort((a, b) => compare(a, b, status))
              .map((request) => ({ request, count: countsOf(request)[status] }))}
            isAdmin={isAdmin}
            reorderEnabled={reorderEnabled && status === priorityStatus}
            showPrintType={showPrintTypes}
            filtered={filtered}
            settlingIds={settlingIds}
            selectionStatus={selection?.status}
            selectedIds={selection?.ids ?? new Set()}
            onOpenRequest={onOpenRequest}
            onStartSelection={(columnStatus, requestId) => {
              const first = requestId ?? requests.find((request) => countsOf(request)[columnStatus] > 0)?.id
              if (first) setSelection({ status: columnStatus, ids: new Set(requestId ? [requestId] : []), anchorId: first })
            }}
            onSelectRequest={(columnStatus, requestId, orderedIds, options) =>
              setSelection((current) => selectBoardRequest(current, columnStatus, orderedIds, requestId, options))
            }
          />
        )
      })}
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
      {selection && selectedEntries.length > 0 && (
        <div
          data-selection-controls
          className="fixed right-3 bottom-3 left-3 z-40 flex items-center gap-2 rounded-xl border bg-popover/95 p-2 shadow-lg backdrop-blur sm:right-auto sm:left-1/2 sm:-translate-x-1/2"
        >
          <span className="whitespace-nowrap px-2 text-sm font-medium">{selectedEntries.length} selected</span>
          <Button size="sm" onClick={() => openBatchMove()}>
            Move
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={clearSelection}>
            Clear selection
          </Button>
        </div>
      )}
      {pendingBatchMove && selection && selectedEntries.length > 0 && (
        <BulkMoveDialog
          entries={selectedEntries}
          destination={pendingBatchMove.to}
          destinations={pendingBatchMove.destinations}
          pending={batchMoveMutation.isPending}
          error={batchError}
          onConfirm={async (counts, destination) => {
            setBatchError(undefined)
            try {
              await batchMoveMutation.mutateAsync({
                data: {
                  workspaceSlug,
                  moves: selectedEntries.map(({ request }) => ({
                    id: request.id,
                    from: pendingBatchMove.from,
                    to: destination,
                    count: counts[request.id],
                  })),
                },
              })
              clearSelection()
            } catch (error) {
              posthog.captureException(error, { action: 'move_request_batch' })
              setBatchError(error instanceof Error ? error.message : 'The batch could not be moved.')
            }
          }}
          onCancel={() => {
            if (!batchMoveMutation.isPending) {
              setPendingBatchMove(null)
              setBatchError(undefined)
            }
          }}
        />
      )}
      {confirmDelete && selection && selectedEntries.length > 0 && (
        <BulkDeleteDialog
          requests={selectedEntries.map(({ request }) => request)}
          onConfirm={async () => {
            try {
              await deleteMutation.mutateAsync({ data: { workspaceSlug, ids: selectedEntries.map(({ request }) => request.id) } })
              clearSelection()
            } catch (error) {
              posthog.captureException(error, { action: 'delete_request_batch' })
              setConfirmDelete(false)
            }
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </main>
  )
}
