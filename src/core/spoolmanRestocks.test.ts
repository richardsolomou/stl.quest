import { describe, expect, it } from 'vitest'
import type { SpoolmanFilament, SpoolmanMatch } from './spoolman'
import { restockFilament, restockMarker } from './spoolmanRestocks'

const filament = (id: number, spools: number): SpoolmanFilament => ({ id, spools, remainingGrams: spools * 1_000 })
const matched = (consumableId: string): SpoolmanMatch => ({ consumableId, by: 'manual' })

describe('restockFilament', () => {
  it('adds the spool to the Spoolman filament counting towards the library filament', () => {
    const matches = new Map([
      [1, matched('other')],
      [2, matched('black')],
    ])

    expect(restockFilament('black', [filament(1, 4), filament(2, 1)], matches)?.id).toBe(2)
  })

  it('prefers the Spoolman filament with the most spools in use', () => {
    const matches = new Map([
      [1, matched('black')],
      [2, matched('black')],
    ])

    expect(restockFilament('black', [filament(1, 1), filament(2, 3)], matches)?.id).toBe(2)
  })

  it('takes the lowest ID when two have as many spools', () => {
    const matches = new Map([
      [5, matched('black')],
      [3, matched('black')],
    ])

    expect(restockFilament('black', [filament(5, 2), filament(3, 2)], matches)?.id).toBe(3)
  })

  it('finds none for a filament Spoolman does not manage', () => {
    expect(restockFilament('black', [filament(1, 1)], new Map())).toBeUndefined()
  })
})

describe('restockMarker', () => {
  it('names the queued spool, so the bridge can find a spool it already added', () => {
    expect(restockMarker('abc')).toBe('stlquest-restock:abc')
  })
})
