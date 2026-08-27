import { describe, expect, it } from 'vitest'
import { requesterColor, requesterColors, requesterInk, requesterLabel } from './requester'

const request = (requesterName: string, requesterId = 'user-1') => ({ requesterId, requesterName })

describe('requester labels', () => {
  it('falls back when the name is blank', () => {
    expect(requesterLabel(request('   '))).toBe('Requester')
  })
})

describe('requester colours', () => {
  it('prefers a stored colour over the generated one', () => {
    expect(requesterColor(request('Kit Aroyan'), [{ id: 'user-1', name: 'Kit Aroyan', color: '#123456' }])).toBe('#123456')
  })

  it('generates the same colour for the same name', () => {
    expect(requesterColor(request('Kit Aroyan'), [])).toBe(requesterColor(request('kit aroyan', 'user-2'), []))
  })

  it('only generates colours from the reserved-safe palette', () => {
    const names = Array.from({ length: 200 }, (_, index) => `Requester ${index}`)
    const generated = new Set(names.map((name) => requesterColor(request(name), [])))
    expect([...generated].every((color) => requesterColors.includes(color as (typeof requesterColors)[number]))).toBe(true)
  })

  it('spreads across the palette rather than collapsing onto one entry', () => {
    const names = Array.from({ length: 200 }, (_, index) => `Requester ${index}`)
    expect(new Set(names.map((name) => requesterColor(request(name), []))).size).toBe(requesterColors.length)
  })
})

describe('requester ink', () => {
  it('gives the same person the same ink from either entry point', () => {
    expect(requesterInk('Kit Aroyan')).toBe(requesterColor(request('Kit Aroyan'), []))
  })

  it('ignores case and surrounding space', () => {
    expect(requesterInk('  KIT AROYAN ')).toBe(requesterInk('Kit Aroyan'))
  })
})
