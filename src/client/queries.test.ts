import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { PublicPrintRequest, PublicRequestQueryResult } from '../core/types'
import { pendingEstimateRefetchInterval, preloadSessionQueries, removeRequestFromQueries, restoreRequestQueries } from './queries'

const request = {
  id: 'request-1',
  name: 'Dragon',
  quantity: 1,
  counts: { pending: 1 },
  orders: {},
  hasThumbnail: false,
  createdAt: 1,
  updatedAt: 1,
  requesterId: 'user-1',
  requesterName: 'Requester',
  mine: true,
  canEdit: true,
  canDelete: true,
  canArchive: true,
  hasFile: true,
  hasSourceImage: false,
  hasPreview: false,
  groups: [],
} satisfies PublicPrintRequest

describe('preloadSessionQueries', () => {
  it('seeds the active workspace session query', async () => {
    const session = { identity: { workspaceSlug: 'workshop' } }
    const setQueryData = vi.fn()
    const queryClient = {
      ensureQueryData: vi.fn().mockResolvedValue(session),
      setQueryData,
    } as unknown as QueryClient

    await preloadSessionQueries(queryClient)

    expect(setQueryData).toHaveBeenCalledWith(['session', 'workshop'], session)
  })

  it('does not seed a workspace query for signed-out sessions', async () => {
    const setQueryData = vi.fn()
    const queryClient = {
      ensureQueryData: vi.fn().mockResolvedValue({ identity: null }),
      setQueryData,
    } as unknown as QueryClient

    await preloadSessionQueries(queryClient)

    expect(setQueryData).not.toHaveBeenCalled()
  })
})

describe('optimistic request deletion', () => {
  it('removes a request from every cached workspace view', async () => {
    const queryClient = new QueryClient()
    const result = {
      requests: [request],
      groups: [
        {
          id: 'group-1',
          name: 'Batch',
          color: 'blue',
          status: 'pending',
          items: [{ requestId: request.id, status: 'pending', count: 1, order: 1 }],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      facets: { requesters: [], total: 1, available: 1 },
    } satisfies PublicRequestQueryResult
    queryClient.setQueryData(['requests', 'workshop', {}], result)
    queryClient.setQueryData(['requests', 'workshop', { search: 'dragon' }], result)
    queryClient.setQueryData(['requests', 'other', {}], result)

    await removeRequestFromQueries(queryClient, 'workshop', request.id)

    expect(queryClient.getQueryData<PublicRequestQueryResult>(['requests', 'workshop', {}])?.requests).toEqual([])
    expect(queryClient.getQueryData<PublicRequestQueryResult>(['requests', 'workshop', { search: 'dragon' }])?.groups[0].items).toEqual([])
    expect(queryClient.getQueryData<PublicRequestQueryResult>(['requests', 'other', {}])?.requests).toEqual([request])
  })

  it('restores cached workspace views when deletion fails', async () => {
    const queryClient = new QueryClient()
    const result = {
      requests: [request],
      groups: [],
      facets: { requesters: [], total: 1, available: 1 },
    } satisfies PublicRequestQueryResult
    const queryKey = ['requests', 'workshop', {}] as const
    queryClient.setQueryData(queryKey, result)
    const snapshots = await removeRequestFromQueries(queryClient, 'workshop', 'request-1')

    restoreRequestQueries(queryClient, snapshots)

    expect(queryClient.getQueryData(queryKey)).toEqual(result)
  })
})

describe('pendingEstimateRefetchInterval', () => {
  function refetchInterval(requests?: PublicPrintRequest[]) {
    const data = requests && { requests, groups: [], facets: { requesters: [], total: 0, available: 0 } }
    return pendingEstimateRefetchInterval({ state: { data } })
  }

  it('polls while a print still waits for its estimate, so a dropped realtime connection cannot leave it pending', () => {
    expect(refetchInterval([request, { ...request, id: 'request-2', estimateGeometryStatus: 'running' }])).toBe(5_000)
    expect(refetchInterval([{ ...request, estimateGeometryStatus: 'pending' }])).toBe(5_000)
  })

  it('stops polling once every estimate has settled', () => {
    expect(refetchInterval()).toBe(false)
    expect(
      refetchInterval([
        { ...request, estimateGeometryStatus: 'ready' },
        { ...request, estimateGeometryStatus: 'failed' },
      ]),
    ).toBe(false)
  })
})
