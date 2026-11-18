import { describe, expect, it } from 'vitest'
import { serializeRouteError } from './RouteError'

describe('route error reporting', () => {
  it('preserves useful error details', () => {
    const error = new TypeError('workspace failed')
    error.stack = 'TypeError: workspace failed\n    at route.tsx:1:1'

    expect(serializeRouteError(error)).toEqual({
      name: 'TypeError',
      message: 'workspace failed',
      stack: 'TypeError: workspace failed\n    at route.tsx:1:1',
    })
  })

  it('truncates details to the reporting limits', () => {
    const error = new Error('m'.repeat(2_001))
    error.name = 'n'.repeat(101)
    error.stack = 's'.repeat(20_001)

    const { name, message, stack } = serializeRouteError(error)
    expect([name.length, message.length, stack?.length]).toEqual([100, 2_000, 20_000])
  })

  it('truncates a thrown non-error value', () => {
    expect(serializeRouteError('x'.repeat(2_001)).message).toHaveLength(2_000)
  })
})
