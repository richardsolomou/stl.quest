import { describe, expect, it, vi } from 'vitest'
import { WorkspaceRuntimeRegistry } from './workspaceRuntimeRegistry'

type TestRuntime = { id: string; current: boolean; close: () => Promise<void> }

function runtime(id: string): TestRuntime {
  return { id, current: true, close: vi.fn(async () => undefined) }
}

describe('WorkspaceRuntimeRegistry', () => {
  it('replaces a runtime invalidated while it is being created', async () => {
    let finishFirst!: (value: TestRuntime) => void
    const stale = runtime('stale')
    const fresh = runtime('fresh')
    const create = vi
      .fn()
      .mockImplementationOnce(async () => await new Promise<TestRuntime>((resolve) => (finishFirst = resolve)))
      .mockResolvedValueOnce(fresh)
    const registry = new WorkspaceRuntimeRegistry<string, TestRuntime>({
      create,
      current: async (value) => value.current,
      revisionTtlMs: 5_000,
    })

    const getting = registry.get('workspace', 'workspace')
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce())
    const invalidating = registry.invalidate('workspace')
    finishFirst(stale)

    await expect(getting).resolves.toBe(fresh)
    await invalidating
    expect(stale.close).toHaveBeenCalledOnce()
  })

  it('invalidates only the selected workspace', async () => {
    const first = runtime('first')
    const second = runtime('second')
    const registry = new WorkspaceRuntimeRegistry<string, TestRuntime>({
      create: async (id) => (id === 'first' ? first : second),
      current: async (value) => value.current,
      revisionTtlMs: 5_000,
    })
    await Promise.all([registry.get('first', 'first'), registry.get('second', 'second')])

    await registry.invalidate('first')

    expect(first.close).toHaveBeenCalledOnce()
    expect(second.close).not.toHaveBeenCalled()
    expect(registry.size).toBe(1)
  })

  it('reuses a current runtime and replaces one with a stale revision', async () => {
    const first = runtime('first')
    const second = runtime('second')
    const create = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const registry = new WorkspaceRuntimeRegistry<string, TestRuntime>({
      create,
      current: async (value) => value.current,
      revisionTtlMs: 0,
    })
    expect(await registry.get('workspace', 'workspace')).toBe(first)
    expect(await registry.get('workspace', 'workspace')).toBe(first)
    first.current = false

    expect(await registry.get('workspace', 'workspace')).toBe(second)
    expect(first.close).toHaveBeenCalledOnce()
  })

  it('retries after runtime creation fails', async () => {
    const recovered = runtime('recovered')
    const create = vi.fn().mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValueOnce(recovered)
    const registry = new WorkspaceRuntimeRegistry<string, TestRuntime>({
      create,
      current: async (value) => value.current,
      revisionTtlMs: 5_000,
    })

    await expect(registry.get('workspace', 'workspace')).rejects.toThrow('storage unavailable')
    await expect(registry.get('workspace', 'workspace')).resolves.toBe(recovered)
  })
})
