import { describe, expect, it } from 'vitest'
import { cleanCloudRoot, cloudFileName, joinCloudPath } from './cloudPath'

describe('cleanCloudRoot', () => {
  it('normalizes surrounding whitespace and slashes', () => {
    expect(cleanCloudRoot(' /models/ ', 'cloud')).toBe('models')
  })

  it.each(['.', '..', 'models/../outside'])('rejects traversal in %s', (root) => {
    try {
      cleanCloudRoot(root, 'cloud')
      throw new Error('Expected traversal to be rejected')
    } catch (error) {
      expect(error).toMatchObject({ status: 400 })
    }
  })
})

it('returns the final cloud path segment', () => {
  expect(cloudFileName('models/example.stl')).toBe('example.stl')
})

it.each([
  ['', '', ''],
  ['root', '', 'root'],
  ['', 'models/example.stl', 'models/example.stl'],
  ['root', 'models/example.stl', 'root/models/example.stl'],
])('joins cloud root %j and relative path %j', (root, relativePath, expected) => {
  expect(joinCloudPath(root, relativePath)).toBe(expected)
})
