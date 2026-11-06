import { describe, expect, it } from 'vitest'
import { messagesFor } from '../core/i18n'
import type { RequestFacets } from '../core/types'
import { activeBoardFilters } from './boardFilterState'

const facets = { requesters: [{ value: 'user-id', label: 'Ada', count: 2 }] } as RequestFacets
const en = messagesFor('en')

describe('activeBoardFilters', () => {
  it('uses the requester label from facets', () => {
    expect(activeBoardFilters(en, { requester: 'user-id' }, facets)).toEqual([{ key: 'requester', label: 'Ada' }])
  })

  it('includes missing metadata filters', () => {
    expect(activeBoardFilters(en, { hasPreview: false }, facets)).toEqual([{ key: 'hasPreview', label: 'Missing 3d preview' }])
  })

  it('describes the per-copy material limit', () => {
    expect(activeBoardFilters(en, { minMaterial: 10, maxMaterial: 80 }, facets)).toEqual([
      { key: 'minMaterial', label: 'Material ≥ 10 per copy' },
      { key: 'maxMaterial', label: 'Material ≤ 80 per copy' },
    ])
  })

  it('localizes the labels', () => {
    expect(activeBoardFilters(messagesFor('fr'), { hasSource: true, printType: 'resin' }, facets)).toEqual([
      { key: 'printType', label: 'Résine' },
      { key: 'hasSource', label: 'Avec lien source' },
    ])
  })
})
