import { useCallback, useEffect, useState } from 'react'
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { useServerFn } from '@tanstack/react-start'
import { usePostHog } from '@posthog/react'
import { useQueryClient } from '@tanstack/react-query'
import type { PublicPrintRequest } from '../core/types'
import type { StatusId, WorkflowDefinition } from '../core/workflow'
import { moveCopies, reorderRequest } from '../server/fns'
import { Column } from './Column'
import { MoveDialog } from './MoveDialog'

type Override = { counts: PublicPrintRequest['counts']; orders: PublicPrintRequest['orders'] }
type PendingMove = { requestId: string; from: StatusId; to: StatusId; max: number; order?: number }

export function Board({
  requests,
  workflow,
  isAdmin,
  hideRequester,
  onOpenRequest,
}: {
  requests: PublicPrintRequest[]
  workflow: WorkflowDefinition
  isAdmin: boolean
  hideRequester: boolean
  onOpenRequest: (requestId: string) => void
}) {
  const posthog = usePostHog()
  const queryClient = useQueryClient()
  const callMoveCopies = useServerFn(moveCopies)
  const callReorder = useServerFn(reorderRequest)
  // Optimistic placement until the live query reflects it; clearing any
  // earlier (e.g. when the server fn resolves) makes copies flash back.
  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)

  const countsOf = useCallback((request: PublicPrintRequest) => overrides[request.id]?.counts ?? request.counts, [overrides])
  const ordersOf = useCallback((request: PublicPrintRequest) => overrides[request.id]?.orders ?? request.orders, [overrides])
  // Unordered requests sort by recency (newest first) via the negated timestamp.
  const sortKey = useCallback(
    (request: PublicPrintRequest, status: StatusId) => ordersOf(request)[status] ?? -request.createdAt,
    [ordersOf],
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
      const nextOrders =
        counts[to] > 0 || order === undefined ? currentOrders : { ...currentOrders, [to]: order }
      setOverrides((prev) => ({ ...prev, [requestId]: { counts: nextCounts, orders: nextOrders } }))
      callMoveCopies({ data: { id: requestId, from, to, count, order } }).then(() => queryClient.invalidateQueries({ queryKey: ['requests'] })).catch((error) => {
        posthog.captureException(error, { action: 'move_request_copies', request_id: requestId, from, to, count })
        revertOverride(requestId)
      })
    },
    [requests, countsOf, ordersOf, callMoveCopies, revertOverride, posthog, queryClient],
  )

  const performReorder = useCallback(
    (requestId: string, status: StatusId, order: number) => {
      const request = requests.find((j) => j.id === requestId)
      if (!request) return
      const nextOrders = { ...ordersOf(request), [status]: order }
      setOverrides((prev) => ({ ...prev, [requestId]: { counts: countsOf(request), orders: nextOrders } }))
      callReorder({ data: { id: requestId, status, order } }).then(() => queryClient.invalidateQueries({ queryKey: ['requests'] })).catch((error) => {
        posthog.captureException(error, { action: 'reorder_request', request_id: requestId, status })
        revertOverride(requestId)
      })
    },
    [requests, countsOf, ordersOf, callReorder, revertOverride, posthog, queryClient],
  )

  useEffect(() => {
    return monitorForElements({
      onDrop({ source, location }) {
        const requestId = source.data.requestId
        const from = source.data.from as StatusId
        const target = location.current.dropTargets[0]
        if (typeof requestId !== 'string' || !target) return

        const columnOf = (status: StatusId) =>
          requests
            .filter((request) => !(request.id === requestId && status === from) && countsOf(request)[status] > 0)
            .sort((a, b) => sortKey(a, status) - sortKey(b, status))

        let to: StatusId
        let order: number | undefined
        if (target.data.type === 'card') {
          const targetRequest = requests.find((request) => request.id === target.data.requestId)
          if (!targetRequest) return
          to = target.data.status as StatusId
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
        } else if (target.data.type === 'column') {
          to = target.data.status as StatusId
          const list = columnOf(to)
          order = list.length ? sortKey(list[list.length - 1], to) + 1 : 0
        } else return

        if (to === from) {
          if (order !== undefined) performReorder(requestId, from, order)
          return
        }
        // Moving copies between statuses stays an operator action; requesters
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
  }, [isAdmin, requests, countsOf, sortKey, performMove, performReorder])

  const pendingRequest = pendingMove ? requests.find((j) => j.id === pendingMove.requestId) : undefined

  return (
    <main className="board">
      {workflow.statuses.map((definition) => {
        const status = definition.id
        return (
        <Column
          key={status}
          status={status}
          definition={definition}
          entries={requests
            .filter((request) => countsOf(request)[status] > 0)
            .sort((a, b) => sortKey(a, status) - sortKey(b, status))
            .map((request) => ({ request, count: countsOf(request)[status] }))}
          isAdmin={isAdmin}
          hideRequester={hideRequester}
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
