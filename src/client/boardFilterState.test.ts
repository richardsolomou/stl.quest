import { describe, expect, it } from 'vitest'
import type { RequestFacets } from '../core/types'
import { activeBoardFilters } from './boardFilterState'

const facets = { requesters: [{ value: 'user-id', label: 'Ada', count: 2 }] } as RequestFacets

describe('activeBoardFilters', () => {
  it('uses the requester label from facets', () => {
    expect(activeBoardFilters({ requester: 'user-id' }, facets)).toEqual([{ key: 'requester', label: 'Ada' }])
  })

  it('includes missing metadata filters', () => {
    expect(activeBoardFilters({ hasPreview: false }, facets)).toEqual([{ key: 'hasPreview', label: 'Missing 3d preview' }])
  })

  it('describes the per-copy material limit', () => {
    expect(activeBoardFilters({ minMaterial: 10, maxMaterial: 80 }, facets)).toEqual([
      { key: 'minMaterial', label: 'Material ≥ 10 per copy' },
      { key: 'maxMaterial', label: 'Material ≤ 80 per copy' },
    ])
  })
})
