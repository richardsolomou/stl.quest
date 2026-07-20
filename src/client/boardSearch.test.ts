import { describe, expect, it } from 'vitest'
import { filtersFromSearch, validateRequestSearch } from './boardSearch'

describe('board sort search', () => {
  it('keeps round robin in the URL without sending it to the repository', () => {
    const search = validateRequestSearch({ sort: 'round-robin' })

    expect(search.sort).toBe('round-robin')
    expect(filtersFromSearch(search).sort).toBe('fair')
  })
})
