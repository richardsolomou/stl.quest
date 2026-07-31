import { describe, expect, it } from 'vitest'
import { uniqueArchiveNames } from './archive'

describe('archive file names', () => {
  it('removes paths and numbers duplicate names case-insensitively', () => {
    expect(uniqueArchiveNames(['folder/model.stl', 'model.stl', 'MODEL.STL'])).toEqual(['model.stl', 'model (2).stl', 'MODEL (3).STL'])
  })
})
