import { describe, expect, it } from 'vitest'
import { assertRelativeStoragePath, hasInvalidRelativePathSegment, hasTraversalSegment } from './storagePath'

describe('storage path segments', () => {
  it('accepts relative storage paths', () => {
    expect(() => assertRelativeStoragePath('models/model.stl')).not.toThrow()
  })

  it('rejects an empty file path', () => {
    expect(() => assertRelativeStoragePath('')).toThrow(expect.objectContaining({ status: 400 }))
  })

  it('allows an explicit root path', () => {
    expect(() => assertRelativeStoragePath('', true)).not.toThrow()
  })

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
