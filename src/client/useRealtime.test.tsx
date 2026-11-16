// @vitest-environment happy-dom
import { EventEmitter } from 'node:events'
import type { Centrifuge, Subscription } from 'centrifuge'
import { act, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RealtimeProvider, useConnectedRealtimeClient, useRealtimeSubscription } from './useRealtime'

const mocks = vi.hoisted(() => ({ client: undefined as unknown }))
vi.mock('./realtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./realtime')>()),
  createRealtimeClient: () => mocks.client,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const reported: unknown[] = []

beforeEach(() => {
  reported.length = 0
  vi.stubGlobal('reportError', (error: unknown) => reported.push(error))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function eventClient(calls: string[] = []) {
  const client = new EventEmitter() as unknown as Centrifuge
  const subscription = new EventEmitter() as unknown as Subscription
  subscription.subscribe = vi.fn(() => void calls.push('subscribe'))
  client.connect = vi.fn(() => void calls.push('connect'))
  client.disconnect = vi.fn(() => void calls.push('disconnect'))
  client.newSubscription = vi.fn((channel: string) => (calls.push(`new ${channel}`), subscription))
  client.removeSubscription = vi.fn(() => void calls.push('remove'))
  return client
}

async function render(node: ReactElement) {
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(node))
  return { update: (next: ReactElement) => root.render(next), unmount: () => root.unmount() }
}

describe('connected client', () => {
  it('configures before connecting and cleans up before disconnecting', async () => {
    const calls: string[] = []
    const client = eventClient(calls)
    const createClient = () => client
    const configure = () => {
      calls.push('configure')
      return () => calls.push('cleanup')
    }
    const Probe = () => (useConnectedRealtimeClient(createClient, true, configure), null)
    const rendered = await render(<Probe />)
    await act(async () => rendered.unmount())
    expect(calls).toEqual(['configure', 'connect', 'cleanup', 'disconnect'])
  })

  it('stops returning the client once disabled', async () => {
    const calls: string[] = []
    const client = eventClient(calls)
    const createClient = () => client
    const observed: (Centrifuge | undefined)[] = []
    const Probe = ({ enabled }: { enabled: boolean }) => (observed.push(useConnectedRealtimeClient(createClient, enabled)), null)
    const rendered = await render(<Probe enabled />)
    await act(async () => rendered.update(<Probe enabled={false} />))
    expect({ last: observed.at(-1), calls }).toEqual({ last: undefined, calls: ['connect', 'disconnect'] })
  })

  it('disconnects a client whose configuration fails', async () => {
    const calls: string[] = []
    const client = eventClient(calls)
    const createClient = () => client
    const configure = () => {
      throw new Error('invalid setup')
    }
    const observed: (Centrifuge | undefined)[] = []
    const Probe = () => (observed.push(useConnectedRealtimeClient(createClient, true, configure)), null)
    await render(<Probe />)
    expect({ calls, last: observed.at(-1) }).toEqual({ calls: ['disconnect'], last: undefined })
  })

  it('reports a configuration failure instead of unmounting the page', async () => {
    const error = new Error('invalid setup')
    const configure = () => {
      throw error
    }
    const Probe = () => (useConnectedRealtimeClient(() => eventClient([]), true, configure), null)
    await render(<Probe />)
    expect(reported).toEqual([error])
  })
})

describe('subscription', () => {
  it('subscribes through the provider and removes the subscription on unmount', async () => {
    const calls: string[] = []
    mocks.client = eventClient(calls)
    const Probe = () => (useRealtimeSubscription('updates:one'), null)
    const rendered = await render(
      <RealtimeProvider>
        <Probe />
      </RealtimeProvider>,
    )
    await act(async () => rendered.unmount())
    // React runs the provider's cleanup first on unmount, so the client may disconnect before the subscription is removed.
    expect(calls.toSorted()).toEqual(['connect', 'disconnect', 'new updates:one', 'remove', 'subscribe'])
  })

  it('runs the subscription cleanup before removing it', async () => {
    const calls: string[] = []
    mocks.client = eventClient(calls)
    const configure = () => () => calls.push('cleanup')
    const Probe = () => (useRealtimeSubscription('updates:one', configure), null)
    const rendered = await render(
      <RealtimeProvider>
        <Probe />
      </RealtimeProvider>,
    )
    await act(async () => rendered.unmount())
    expect(calls.filter((call) => call === 'cleanup' || call === 'remove')).toEqual(['cleanup', 'remove'])
  })

  it('removes a subscription whose configuration fails', async () => {
    const calls: string[] = []
    mocks.client = eventClient(calls)
    const configure = () => {
      throw new Error('invalid setup')
    }
    const Probe = () => (useRealtimeSubscription('updates:one', configure), null)
    await render(
      <RealtimeProvider>
        <Probe />
      </RealtimeProvider>,
    )
    expect({ removed: calls.includes('remove'), reported: reported.map(String) }).toEqual({
      removed: true,
      reported: ['Error: invalid setup'],
    })
  })
})
