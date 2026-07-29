import { describe, expect, it } from 'vitest'
import { assetMissingError, uploadPartMissingError } from './missingFile'

describe('missing file errors', () => {
  it('identifies missing assets as ENOENT', () => {
    expect(assetMissingError('todo/model.stl')).toMatchObject({ message: 'asset missing: todo/model.stl', code: 'ENOENT' })
  })

  it('identifies missing upload parts as ENOENT', () => {
    expect(uploadPartMissingError('staged/model.stl')).toMatchObject({ message: 'upload part missing: staged/model.stl', code: 'ENOENT' })
  })
})
