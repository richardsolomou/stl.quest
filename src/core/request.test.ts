import { describe, expect, it } from 'vitest'
import {
  canAttachModel,
  MAX_REQUEST_NAME_LENGTH,
  MAX_REQUEST_NOTES_LENGTH,
  MAX_REQUEST_PRINTER_ID_LENGTH,
  MAX_REQUEST_SOURCE_URL_LENGTH,
  normalizeRequestQuantity,
  requestAssetPaths,
  validRequestQuantity,
  validRequestUpdate,
  validSourceUrl,
} from './request'

it('returns every stored asset path for a request', () => {
  expect(requestAssetPaths({ filePath: 'model.stl', previewPath: 'preview.phm' })).toEqual(['model.stl', 'preview.phm'])
})

describe('canAttachModel', () => {
  it('accepts an editable print while storage takes writes', () => {
    expect(canAttachModel({ canEdit: true }, true)).toBe(true)
  })

  it.each([
    ['the print is locked', { canEdit: false }, true],
    ['storage cannot take writes', { canEdit: true }, false],
  ])('rejects it when %s', (_name, request, uploadsEnabled) => {
    expect(canAttachModel(request, uploadsEnabled)).toBe(false)
  })
})

describe('normalizeRequestQuantity', () => {
  it.each([
    ['missing values', undefined, 1, undefined],
    ['decimal values', '2.6', 3, undefined],
    ['values below the minimum', -4, 1, undefined],
    ['values above the maximum', 80, 50, undefined],
    ['custom fallbacks', '', 7, 7],
  ])('%s', (_name, value, expected, fallback) => {
    expect(normalizeRequestQuantity(value, fallback)).toBe(expected)
  })
})

describe('validRequestQuantity', () => {
  it.each([1, 25, 50])('accepts %s', (value) => {
    expect(validRequestQuantity(value)).toBe(true)
  })

  it.each([0, 51, 1.5, '2'])('rejects %s', (value) => {
    expect(validRequestQuantity(value)).toBe(false)
  })
})

describe('validSourceUrl', () => {
  it.each(['http://example.com/model', 'https://example.com/model'])('accepts %s', (value) => {
    expect(validSourceUrl(value)).toBe(true)
  })

  it.each(['ftp://example.com/model', 'not a URL', `https://example.com/${'x'.repeat(MAX_REQUEST_SOURCE_URL_LENGTH)}`])(
    'rejects %s',
    (value) => {
      expect(validSourceUrl(value)).toBe(false)
    },
  )
})

describe('validRequestUpdate', () => {
  it('accepts supported request fields', () => {
    expect(
      validRequestUpdate({
        name: 'Model',
        quantity: 2,
        notes: 'Print in blue',
        sourceUrl: 'https://example.com/model',
        requestedPrintType: 'filament',
        printerId: null,
      }),
    ).toBe(true)
  })

  it.each([
    ['empty names', { name: ' ' }],
    ['long names', { name: 'x'.repeat(MAX_REQUEST_NAME_LENGTH + 1) }],
    ['invalid quantities', { quantity: 0 }],
    ['long notes', { notes: 'x'.repeat(MAX_REQUEST_NOTES_LENGTH + 1) }],
    ['invalid source URLs', { sourceUrl: 'ftp://example.com/model' }],
    ['invalid print types', { requestedPrintType: 'powder' }],
    ['long printer IDs', { printerId: 'x'.repeat(MAX_REQUEST_PRINTER_ID_LENGTH + 1) }],
  ])('rejects %s', (_name, fields) => {
    expect(validRequestUpdate(fields)).toBe(false)
  })
})
