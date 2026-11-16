import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthAction } from './useAuthAction'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let action: ReturnType<typeof useAuthAction>
let rendered: ReactTestRenderer

beforeEach(async () => {
  // react-test-renderer warns that it is deprecated on every render.
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  await act(async () => {
    rendered = create(createElement(() => ((action = useAuthAction()), null)))
  })
})

afterEach(async () => {
  await act(async () => rendered.unmount())
  vi.restoreAllMocks()
})

describe('useAuthAction', () => {
  it('is busy while the call runs', async () => {
    let finish!: (value: { data: null }) => void
    await act(async () => {
      void action.run(() => new Promise<{ data: null }>((resolve) => (finish = resolve)))
    })
    expect(action.busy).toBe(true)
    await act(async () => finish({ data: null }))
  })

  it("shows Better Auth's message for a returned error", async () => {
    await act(async () => {
      await action.run(() => Promise.resolve({ error: { message: 'Account disabled.' } }))
    })
    expect({ busy: action.busy, error: action.error }).toEqual({ busy: false, error: 'Account disabled.' })
  })

  it('returns a thrown failure as the result error', async () => {
    const failure = new Error('Network unavailable.')
    let result: unknown
    await act(async () => {
      result = await action.run(() => Promise.reject(failure))
    })
    expect(result).toEqual({ error: failure })
  })

  it('keeps the answer of the latest call', async () => {
    let finishFirst!: (value: { error: { message: string } }) => void
    await act(async () => {
      void action.run(() => new Promise<{ error: { message: string } }>((resolve) => (finishFirst = resolve)))
      await action.run(() => Promise.resolve({ data: null }))
    })
    await act(async () => finishFirst({ error: { message: 'Too late.' } }))
    expect(action.error).toBeUndefined()
  })
})
