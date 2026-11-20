import { describe, expect, it } from 'vitest'
import { matchesListSearch, showsListSearch } from './listSearch'

describe('showsListSearch', () => {
  it('leaves a short list to be scanned', () => {
    expect(showsListSearch(7)).toBe(false)
  })

  it('offers search once a list is long enough to hunt through', () => {
    expect(showsListSearch(8)).toBe(true)
  })
})

describe('matchesListSearch', () => {
  it('matches everything for an empty query', () => {
    expect(matchesListSearch('  ', ['X1C · A'])).toBe(true)
  })

  it('matches any field, ignoring case', () => {
    expect(matchesListSearch('bambu', ['X1C · A', 'Bambu Lab X1 Carbon'])).toBe(true)
  })

  it('needs every word to match somewhere', () => {
    expect(matchesListSearch('bambu resin', ['X1C · A', 'Bambu Lab X1 Carbon'])).toBe(false)
  })

  it('ignores missing fields', () => {
    expect(matchesListSearch('form', [undefined, 'Form 4'])).toBe(true)
  })
})
