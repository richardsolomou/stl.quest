import { useCallback, useEffect, useMemo, useState } from 'react'
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { useServerFn } from '@tanstack/react-start'
import { usePostHog } from '@posthog/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { PublicPrintRequest, RequestSort } from '../../core/types'
import type { PrinterSummary } from '../../core/types'
import type { StatusId, WorkflowDefinition } from '../../core/workflow'
import { moveCopies, reorderRequest } from '../../server/fns'
import { Column } from './Column'
import { MoveDialog } from './MoveDialog'

type Override = { counts: PublicPrintRequest['counts']; orders: PublicPrintRequest['orders'] }
type PendingMove = { requestId: string; from: StatusId; to: StatusId; max: number; order?: number }

export function Board({
  requests,
  workflow,
  isAdmin,
  showPrintTypes,
  printers,
  filtered = false,
  sort,
  onOpenRequest,
}: {
  requests: PublicPrintRequest[]
  workflow: WorkflowDefinition
  isAdmin: boolean
  showPrintTypes: boolean
  printers: PrinterSummary[]
  filtered?: boolean
  sort: RequestSort
  onOpenRequest: (requestId: string) => void
}) {
  const posthog = usePostHog()
  const queryClient = useQueryClient()
  const callMoveCopies = useServerFn(moveCopies)
  const callReorder = useServerFn(reorderRequest)
  const moveMutation = useMutation({
    mutationFn: callMoveCopies,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['requests'] }),
  })
  const reorderMutation = useMutation({
    mutationFn: callReorder,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['requests'] }),
  })
  // Optimistic placement until the live query reflects it; clearing any
  // earlier (e.g. when the server fn resolves) makes copies flash back.
  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const [settlingIds, setSettlingIds] = useState<Set<string>>(new Set())

  const countsOf = useCallback((request: PublicPrintRequest) => overrides[request.id]?.counts ?? request.counts, [overrides])
  const ordersOf = useCallback((request: PublicPrintRequest) => overrides[request.id]?.orders ?? request.orders, [overrides])
  // Unordered requests sort by recency (newest first) via the negated timestamp.
  const sortKey = useCallback(
    (request: PublicPrintRequest, status: StatusId) => ordersOf(request)[status] ?? -request.createdAt,
    [ordersOf],
  )
  const serverRank = useMemo(() => new Map(requests.map((request, index) => [request.id, index])), [requests])
  const compare = useCallback(
    (left: PublicPrintRequest, right: PublicPrintRequest, status: StatusId) =>
      sort === 'board' ? sortKey(left, status) - sortKey(right, status) : (serverRank.get(left.id) ?? 0) - (serverRank.get(right.id) ?? 0),
    [serverRank, sort, sortKey],
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
    (requestId: string, from: StatusId, to: StatusId, count: number, order?: number) => {
      const request = requests.find((j) => j.id === requestId)
      if (!request) return
      const counts = countsOf(request)
      const nextCounts = { ...counts, [from]: counts[from] - count, [to]: counts[to] + count }
      const currentOrders = ordersOf(request)
      const nextOrders = counts[to] > 0 || order === undefined ? currentOrders : { ...currentOrders, [to]: order }
      setOverrides((prev) => ({ ...prev, [requestId]: { counts: nextCounts, orders: nextOrders } }))
      moveMutation.mutate(
        { data: { id: requestId, from, to, count, order } },
        {
          onError: (error) => {
            posthog.captureException(error, { action: 'move_request_copies', print_type: request.printType, from, to, count })
            revertOverride(requestId)
          },
        },
      )
    },
    [requests, countsOf, ordersOf, moveMutation, revertOverride, posthog],
  )

  const performReorder = useCallback(
    (requestId: string, status: StatusId, order: number) => {
      const request = requests.find((j) => j.id === requestId)
      if (!request) return
      const nextOrders = { ...ordersOf(request), [status]: order }
      setOverrides((prev) => ({ ...prev, [requestId]: { counts: countsOf(request), orders: nextOrders } }))
      reorderMutation.mutate(
        { data: { id: requestId, status, order } },
        {
          onError: (error) => {
            posthog.captureException(error, { action: 'reorder_request', print_type: request.printType, status })
            revertOverride(requestId)
          },
        },
      )
    },
    [requests, countsOf, ordersOf, reorderMutation, revertOverride, posthog],
  )

  useEffect(() => {
    return monitorForElements({
      onDrop({ source, location }) {
        const requestId = source.data.requestId
        const from = source.data.from as StatusId
        const target = location.current.dropTargets[0]
        if (typeof requestId !== 'string' || !target) return
        setSettlingIds((current) => new Set(current).add(requestId))
        window.setTimeout(() => setSettlingIds((current) => new Set([...current].filter((id) => id !== requestId))), 260)

        const columnOf = (status: StatusId) =>
          requests
            .filter((request) => !(request.id === requestId && status === from) && countsOf(request)[status] > 0)
            .sort((a, b) => compare(a, b, status))

        let to: StatusId
        let order: number | undefined
        if (target.data.type === 'card') {
          const targetRequest = requests.find((request) => request.id === target.data.requestId)
          if (!targetRequest) return
          to = target.data.status as StatusId
          if (sort === 'board') {
            const list = columnOf(to)
            const index = list.findIndex((request) => request.id === targetRequest.id)
            if (index === -1) return
            const edge = extractClosestEdge(target.data)
            const before = edge === 'top' ? list[index - 1] : list[index]
            const after = edge === 'top' ? list[index] : list[index + 1]
            order =
              before && after
                ? (sortKey(before, to) + sortKey(after, to)) / 2
                : before
                  ? sortKey(before, to) + 1
                  : after
                    ? sortKey(after, to) - 1
                    : 0
          }
        } else if (target.data.type === 'column') {
          to = target.data.status as StatusId
          if (sort === 'board') {
            const list = columnOf(to)
            order = list.length ? sortKey(list[list.length - 1], to) + 1 : 0
          }
        } else return

        if (to === from) {
          if (sort !== 'board') return
          if (order !== undefined) performReorder(requestId, from, order)
          return
        }
        // Moving copies between statuses stays an admin action; requesters
        // only rearrange within a column.
        if (!isAdmin) return
        const request = requests.find((j) => j.id === requestId)
        if (!request) return
        const available = countsOf(request)[from]
        if (available <= 0) return
        if (available === 1) performMove(requestId, from, to, 1, order)
        else setPendingMove({ requestId, from, to, max: available, order })
      },
    })
  }, [isAdmin, requests, countsOf, compare, sortKey, sort, performMove, performReorder])

  const pendingRequest = pendingMove ? requests.find((j) => j.id === pendingMove.requestId) : undefined
  const dragEnabled = sort === 'board'

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
              : 'Add a private STL request to start tracking copies from Queue through Printing, Finishing, and Ready.'}
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="board grid min-h-0 flex-1 grid-flow-col grid-cols-none auto-cols-[minmax(280px,1fr)] gap-3 overflow-x-auto p-3 max-[900px]:auto-cols-[82%]">
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
            dragEnabled={dragEnabled}
            showPrintType={showPrintTypes}
            printers={printers}
            filtered={filtered}
            settlingIds={settlingIds}
            onOpenRequest={onOpenRequest}
          />
        )
      })}
      {pendingMove && pendingRequest && (
        <MoveDialog
          requestName={pendingRequest.name}
          toLabel={workflow.statuses.find((status) => status.id === pendingMove.to)?.label ?? pendingMove.to}
          max={pendingMove.max}
          onConfirm={(count) => {
            performMove(pendingMove.requestId, pendingMove.from, pendingMove.to, count, pendingMove.order)
            setPendingMove(null)
          }}
          onCancel={() => setPendingMove(null)}
        />
      )}
    </main>
  )
}
