import { describe, expect, it } from 'vitest'
import { requestPrintTypeChoices } from './fleet'

describe('request print type choices', () => {
  it('offers only what the workspace prints', () => {
    expect(requestPrintTypeChoices(['filament'], 'filament')).toEqual(['filament'])
  })

  it('keeps the type a print already has', () => {
    expect(requestPrintTypeChoices(['filament'], 'resin')).toEqual(['resin', 'filament'])
  })

  it('offers both types in a fixed order', () => {
    expect(requestPrintTypeChoices(['filament', 'resin'])).toEqual(['resin', 'filament'])
  })
})
