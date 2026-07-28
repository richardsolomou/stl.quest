import { describe, expect, it, vi } from 'vitest'
import type { AppEvent } from '../core/types'
import { resetOnRemoteStorageChange } from './app'

describe('distributed runtime invalidation', () => {
  it('resets the replica after a remote storage change', async () => {
    let listener: ((workspaceId: string, event: AppEvent) => void | Promise<void>) | undefined
    const reset = vi.fn(async () => undefined)
    resetOnRemoteStorageChange(
      {
        onRemoteEvent: (registered) => {
          listener = registered
          return () => false
        },
      },
      reset,
    )

    await listener?.('workspace', 'storage.changed')

    expect(reset).toHaveBeenCalledOnce()
  })
})
