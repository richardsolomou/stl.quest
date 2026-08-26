import { describe, expect, it } from 'vitest'
import { requestCoverHref, requestDownloadHref, requestModelHref, requestThumbnailHref } from './boardDownload'

const print = (id: string, updatedAt = 1700) => ({ id, updatedAt })

describe('requestDownloadHref', () => {
  it('downloads a single request directly', () => {
    expect(requestDownloadHref([print('abc')])).toBe('/api/files/abc?v=1700')
  })

  it('downloads several requests as a batch archive', () => {
    expect(requestDownloadHref(['a', 'b', 'c'].map((id) => print(id)))).toBe('/api/files/batch?id=a&id=b&id=c')
  })

  it('encodes ids in the batch query', () => {
    expect(requestDownloadHref(['a b', 'c&d'].map((id) => print(id)))).toBe('/api/files/batch?id=a+b&id=c%26d')
  })
})

// Both routes answer with a year of immutable caching, so a replaced model has to arrive under a new URL.
describe('stored asset urls', () => {
  it.each([
    ['the model', () => requestModelHref(print('abc'), false), '/api/files/abc?inline=1&v=1700'],
    ['its preview mesh', () => requestModelHref(print('abc'), true), '/api/files/abc?inline=1&preview=1&v=1700'],
    ['its thumbnail', () => requestThumbnailHref(print('abc')), '/api/thumbs/abc?v=1700'],
    ['its source cover', () => requestCoverHref(print('abc')), '/api/source-images/abc?v=1700'],
  ])('versions %s by the print last change', (_name, build, expected) => {
    expect(build()).toBe(expected)
  })

  it('moves every url when the stored model is replaced', () => {
    expect(requestThumbnailHref(print('abc', 1800))).not.toBe(requestThumbnailHref(print('abc', 1700)))
    expect(requestModelHref(print('abc', 1800), false)).not.toBe(requestModelHref(print('abc', 1700), false))
  })
})
