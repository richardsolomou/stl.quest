// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PostHogIdentity } from './postHogIdentity'

type SessionState = { data?: { user: { id: string } } | null; error?: Error | null; isPending: boolean }

const { posthog, useSession } = vi.hoisted(() => ({
  posthog: { __loaded: true, get_property: vi.fn(), identify: vi.fn(), reset: vi.fn() },
  useSession: vi.fn(),
}))

vi.mock('@posthog/react', () => ({ usePostHog: () => posthog }))
vi.mock('./authClient', () => ({ authClient: { useSession } }))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined

async function render(state: SessionState) {
  useSession.mockReturnValue(state)
  root ??= createRoot(document.createElement('div'))
  await act(async () => root?.render(<PostHogIdentity />))
}

const signedIn = (id: string): SessionState => ({ data: { user: { id } }, isPending: false })
const signedOut: SessionState = { data: null, isPending: false }

beforeEach(() => {
  posthog.__loaded = true
  posthog.get_property.mockReturnValue(undefined)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  vi.clearAllMocks()
})

describe('PostHogIdentity', () => {
  it('identifies the signed-in user by id alone', async () => {
    await render(signedIn('user-1'))
    expect(posthog.identify.mock.calls).toEqual([['user-1', undefined]])
  })

  it('adds the product-safe properties it is given', async () => {
    useSession.mockReturnValue(signedIn('user-1'))
    root = createRoot(document.createElement('div'))
    await act(async () => root?.render(<PostHogIdentity properties={{ role: 'admin' }} />))
    expect(posthog.identify.mock.calls).toEqual([['user-1', { role: 'admin' }]])
  })

  it('does nothing while PostHog is off', async () => {
    posthog.__loaded = false
    posthog.get_property.mockReturnValue('user-1')
    await render(signedOut)
    expect(posthog.reset).not.toHaveBeenCalled()
  })

  it('does not reset a signed-out visitor nobody identified', async () => {
    await render(signedOut)
    expect(posthog.reset).not.toHaveBeenCalled()
  })

  it('resets once after the identified user signs out, not while the session loads', async () => {
    await render(signedIn('user-1'))
    await render({ isPending: true })
    await render(signedOut)
    expect(posthog.reset).toHaveBeenCalledOnce()
  })

  it('resets an identity saved earlier when the page loads signed out', async () => {
    posthog.get_property.mockImplementation((property: string) => (property === '$user_id' ? 'user-1' : undefined))
    await render(signedOut)
    expect(posthog.reset).toHaveBeenCalledOnce()
  })

  it('resets before identifying a different user', async () => {
    posthog.get_property.mockReturnValue('administrator')
    await render(signedIn('impersonated'))
    expect(posthog.reset.mock.invocationCallOrder[0]).toBeLessThan(posthog.identify.mock.invocationCallOrder[0]!)
  })

  it('keeps the analytics session when the saved identity is the same user', async () => {
    posthog.get_property.mockReturnValue('user-1')
    await render(signedIn('user-1'))
    expect(posthog.reset).not.toHaveBeenCalled()
  })

  it('keeps the identity when a session refresh fails', async () => {
    await render(signedIn('user-1'))
    await render({ data: null, error: new Error('offline'), isPending: false })
    expect(posthog.reset).not.toHaveBeenCalled()
  })
})
