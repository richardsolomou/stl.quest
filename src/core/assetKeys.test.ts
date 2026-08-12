import { describe, expect, it } from 'vitest'
import { assetContentType, createAssetKey, previewKey, thumbnailKey } from './assetKeys'

describe('preview asset keys', () => {
  it('uses the current quantized preview extension', () => {
    expect(previewKey('todo/model.stl')).toBe('previews/model.phm')
  })

  it('preserves 3MF model files and uses format-independent generated keys', () => {
    const key = createAssetKey('00000000-0000-4000-8000-000000000001', 'Assembly.3MF')
    expect(key).toBe('models/00000000-0000-4000-8000-000000000001__Assembly.3mf')
    expect(assetContentType(key)).toBe('application/vnd.ms-package.3dmanufacturing-3dmodel+xml')
    expect(previewKey(key)).toBe('previews/00000000-0000-4000-8000-000000000001__Assembly.phm')
    expect(thumbnailKey(key, 'image/png')).toBe('thumbnails/00000000-0000-4000-8000-000000000001__Assembly.png')
  })
})
