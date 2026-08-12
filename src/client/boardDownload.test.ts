import { describe, expect, it } from 'vitest'
import { requestDownloadHref } from './boardDownload'

describe('requestDownloadHref', () => {
  it('downloads a single request directly', () => {
    expect(requestDownloadHref(['abc'])).toBe('/api/files/abc')
  })

  it('downloads several requests as a batch archive', () => {
    expect(requestDownloadHref(['a', 'b', 'c'])).toBe('/api/files/batch?id=a&id=b&id=c')
  })

  it('encodes ids in the batch query', () => {
    expect(requestDownloadHref(['a b', 'c&d'])).toBe('/api/files/batch?id=a+b&id=c%26d')
  })
})
