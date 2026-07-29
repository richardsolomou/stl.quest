import { describe, expect, it, vi } from 'vitest'
import { canViewManagedStorageUsage, captureRouteError } from './fns'

describe('managed storage usage', () => {
  it('hides account-level usage from requesters', () => {
    expect(canViewManagedStorageUsage('requester')).toBe(false)
  })

  it('shows account-level usage to admins', () => {
    expect(canViewManagedStorageUsage('admin')).toBe(true)
  })
})

describe('route errors', () => {
  it('reports the original browser error through server telemetry', async () => {
    const exception = vi.fn(async () => undefined)

    await captureRouteError(
      { exception },
      { name: 'TypeError', message: 'workspace failed', stack: 'TypeError: workspace failed\n    at route.tsx:1:1' },
    )

    expect(exception).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'TypeError', message: 'workspace failed', stack: expect.stringContaining('route.tsx:1:1') }),
      { action: 'route_error' },
    )
  })
})
