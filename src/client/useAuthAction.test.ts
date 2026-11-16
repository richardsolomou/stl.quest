// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAuthAction } from './useAuthAction'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let action: ReturnType<typeof useAuthAction>
let root: Root

beforeEach(async () => {
  root = createRoot(document.createElement('div'))
  await act(async () => root.render(createElement(() => ((action = useAuthAction()), null))))
})

afterEach(async () => {
  await act(async () => root.unmount())
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
