import { describe, expect, it } from 'vitest'
import { serializeRouteError } from './RouteError'

describe('route error reporting', () => {
  it('preserves useful error details within the reporting limits', () => {
    const error = new TypeError('workspace failed')
    error.stack = 'TypeError: workspace failed\n    at route.tsx:1:1'

    expect(serializeRouteError(error)).toEqual({
      name: 'TypeError',
      message: 'workspace failed',
      stack: 'TypeError: workspace failed\n    at route.tsx:1:1',
    })
  })
})
