import { describe, expect, it } from 'vitest'
import { MAX_ARCHIVE_FILES, copyDownloadIds, uniqueArchiveNames } from './archive'

describe('archive file names', () => {
  it('removes paths and numbers duplicate names case-insensitively', () => {
    expect(uniqueArchiveNames(['folder/model.stl', 'model.stl', 'MODEL.STL'])).toEqual(['model.stl', 'model (2).stl', 'MODEL (3).STL'])
  })
})

describe('copyDownloadIds', () => {
  it('repeats each model once per copy', () => {
    expect(
      copyDownloadIds([
        { id: 'a', copies: 3 },
        { id: 'b', copies: 1 },
      ]),
    ).toEqual(['a', 'a', 'a', 'b'])
  })

  it('offers nothing when every model has one copy', () => {
    expect(
      copyDownloadIds([
        { id: 'a', copies: 1 },
        { id: 'b', copies: 1 },
      ]),
    ).toBeUndefined()
  })

  it('offers nothing beyond the archive file limit', () => {
    expect(copyDownloadIds([{ id: 'a', copies: MAX_ARCHIVE_FILES + 1 }])).toBeUndefined()
  })

  it('allows exactly the archive file limit', () => {
    expect(copyDownloadIds([{ id: 'a', copies: MAX_ARCHIVE_FILES }])).toHaveLength(MAX_ARCHIVE_FILES)
  })
})
