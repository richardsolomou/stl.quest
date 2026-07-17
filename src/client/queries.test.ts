import type { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { preloadSessionQueries } from './queries'

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
