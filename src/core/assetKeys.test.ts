import { describe, expect, it } from 'vitest'
import { previewKey } from './assetKeys'

describe('preview asset keys', () => {
  it('uses the current quantized preview extension', () => {
    expect(previewKey('todo/model.stl')).toBe('.printhub/previews/model.phm')
  })
})
