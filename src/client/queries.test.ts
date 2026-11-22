import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { PublicPrintRequest, PublicRequestQueryResult } from '../core/types'
import {
  pendingEstimateRefetchInterval,
  preloadSessionQueries,
  preloadSettingsSection,
  removeRequestFromQueries,
  restoreRequestQueries,
} from './queries'
import type { SettingsSection } from './settingsSections'

const request = {
  id: 'request-1',
  number: 1,
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

describe('preloadSettingsSection', () => {
  const admin = { identity: { role: 'admin', workspaceSlug: 'workshop' }, usageTracking: true }
  async function preloadedKeys(section: SettingsSection, session: unknown = admin) {
    const prefetchQuery = vi.fn().mockResolvedValue(undefined)
    const queryClient = { ensureQueryData: vi.fn().mockResolvedValue(session), prefetchQuery } as unknown as QueryClient
    await preloadSettingsSection(queryClient, section)
    return prefetchQuery.mock.calls.map(([options]) => options.queryKey)
  }

  it('loads the equipment section with the consumables it uses', async () => {
    expect(await preloadedKeys('equipment')).toEqual([
      ['equipment', 'workshop'],
      ['consumables', 'workshop'],
    ])
  })

  it('loads the consumables section with its stock when usage is tracked', async () => {
    expect(await preloadedKeys('consumables')).toContainEqual(['stock', 'workshop'])
  })

  it('leaves stock out of the consumables section when usage is not tracked', async () => {
    expect(await preloadedKeys('consumables', { ...admin, usageTracking: false })).not.toContainEqual(['stock', 'workshop'])
  })

  it('waits for the section’s data while rendering on the server', async () => {
    let settle = () => {}
    const prefetchQuery = vi.fn(() => new Promise<void>((resolve) => (settle = resolve)))
    const queryClient = { ensureQueryData: vi.fn().mockResolvedValue(admin), prefetchQuery } as unknown as QueryClient
    const preload = preloadSettingsSection(queryClient, 'email').then(() => 'loaded')
    await Promise.resolve()
    expect(await Promise.race([preload, new Promise((resolve) => setTimeout(() => resolve('waiting'), 10))])).toBe('waiting')
    settle()
  })

  it('switches sections in the browser without waiting, so the pane shows its own loading state', async () => {
    vi.stubGlobal('document', {})
    try {
      const prefetchQuery = vi.fn(() => new Promise<void>(() => {}))
      const queryClient = { ensureQueryData: vi.fn().mockResolvedValue(admin), prefetchQuery } as unknown as QueryClient
      await expect(preloadSettingsSection(queryClient, 'email')).resolves.toBeUndefined()
      expect(prefetchQuery).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('loads nothing for a member, whom the page sends away', async () => {
    expect(await preloadedKeys('equipment', { identity: { role: 'member', workspaceSlug: 'workshop' } })).toEqual([])
  })
})
