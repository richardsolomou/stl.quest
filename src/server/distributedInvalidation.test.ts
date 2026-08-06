import { describe, expect, it, vi } from 'vitest'
import { resetOnRemoteStorageChange, storageRuntimeIsCurrent } from './app'

describe('distributed runtime invalidation', () => {
  it('resets the replica after a remote storage change', async () => {
    let listener: ((workspaceId: string) => void | Promise<void>) | undefined
    const reset = vi.fn(async () => undefined)
    resetOnRemoteStorageChange(
      {
        onRemoteChange: (registered) => {
          listener = registered
          return () => false
        },
      },
      reset,
    )

    await listener?.('workspace')

    expect(reset).toHaveBeenCalledOnce()
  })

  it('detects a missed storage change from its durable revision', async () => {
    const repository = { getSetting: async <T>() => 'new-revision' as T }

    expect(await storageRuntimeIsCurrent(repository, 'old-revision')).toBe(false)
  })
})
