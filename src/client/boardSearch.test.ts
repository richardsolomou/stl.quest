import { describe, expect, it } from 'vitest'
import { filtersFromSearch, validateRequestSearch } from './boardSearch'

describe('board sort search', () => {
  it('preserves a sign-up request', () => {
    expect(validateRequestSearch({ signup: 'true' }).signup).toBe(true)
  })

  it('keeps round robin in the URL without sending it to the repository', () => {
    const search = validateRequestSearch({ sort: 'round-robin' })

    expect(search.sort).toBe('round-robin')
    expect(filtersFromSearch(search).sort).toBe('fair')
  })

  it('parses estimate sorting and material limits', () => {
    const search = validateRequestSearch({ sort: 'material-asc', maxMaterial: '80' })

    expect(search).toMatchObject({ sort: 'material-asc', maxMaterial: 80 })
    expect(filtersFromSearch(search)).toMatchObject({ sort: 'material-asc', maxEstimatedMaterial: 80 })
  })
})
