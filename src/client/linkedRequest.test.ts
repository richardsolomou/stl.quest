import { describe, expect, it } from 'vitest'
import { linkedRequestData, linkedRequestDirty, linkedRequestValidationError, linkedRequestValues } from './linkedRequest'

describe('linked request form', () => {
  it('normalizes valid request data', () => {
    expect(
      linkedRequestData('workshop', {
        name: '  Cable organizer  ',
        quantity: '2',
        notes: '  Black PLA  ',
        sourceUrl: '  https://makerworld.com/models/cable-organizer  ',
        printType: 'filament',
      }),
    ).toEqual({
      workspaceSlug: 'workshop',
      name: 'Cable organizer',
      quantity: 2,
      notes: 'Black PLA',
      sourceUrl: 'https://makerworld.com/models/cable-organizer',
      requestedPrintType: 'filament',
    })
  })

  it('rejects missing and unsafe links', () => {
    const values = { ...linkedRequestValues('filament'), name: 'Cable organizer', sourceUrl: 'javascript:alert(1)' }

    expect(linkedRequestValidationError(values)).toBe('Enter a valid http(s) source link.')
  })

  it('only marks user-entered values as dirty', () => {
    const values = linkedRequestValues('filament')

    expect(linkedRequestDirty(values)).toBe(false)
    expect(linkedRequestDirty({ ...values, notes: 'Black PLA' })).toBe(true)
  })
})
