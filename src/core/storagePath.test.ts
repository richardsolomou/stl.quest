import { describe, expect, it } from 'vitest'
import { hasInvalidRelativePathSegment, hasTraversalSegment } from './storagePath'

describe('storage path segments', () => {
  it.each(['.', '..', 'models/../outside'])('detects traversal in %s', (path) => {
    expect(hasTraversalSegment(path)).toBe(true)
  })

  it('allows an empty storage root', () => {
    expect(hasTraversalSegment('')).toBe(false)
  })

  it.each(['', '/model.stl', 'folder//model.stl'])('rejects invalid relative path %j', (path) => {
    expect(hasInvalidRelativePathSegment(path)).toBe(true)
  })
})
