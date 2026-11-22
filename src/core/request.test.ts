import { describe, expect, it } from 'vitest'
import {
  canAttachModel,
  MAX_REQUEST_NAME_LENGTH,
  MAX_REQUEST_NOTES_LENGTH,
  MAX_REQUEST_PRINTER_ID_LENGTH,
  MAX_REQUEST_SOURCE_URL_LENGTH,
  normalizeRequestQuantity,
  requestAssetPaths,
  sourceCoverChange,
  taggedRequestNumber,
  validRequestQuantity,
  validRequestUpdate,
  validSourceUrl,
  requestTag,
  taggedFileName,
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

describe('sourceCoverChange', () => {
  const link = 'https://makerworld.com/en/models/12702'

  it('replaces the cover when the link changes', () => {
    expect(sourceCoverChange({ sourceUrl: link, sourceImagePath: 'covers/a' }, 'https://www.printables.com/model/3161')).toBe('replace')
  })

  it('fills in a cover for the same link while the print has none', () => {
    expect(sourceCoverChange({ sourceUrl: link }, ` ${link} `)).toBe('fill')
  })

  it('keeps a supplied cover when the same link is saved again', () => {
    expect(sourceCoverChange({ sourceUrl: link, sourceImagePath: 'covers/a' }, link)).toBe('keep')
  })

  it('keeps a resolved cover when the same link is saved again', () => {
    expect(sourceCoverChange({ sourceUrl: link, sourceImageUrl: 'https://makerworld.bblmw.com/a.png' }, link)).toBe('keep')
  })

  it('keeps the cover when the link is not part of the save', () => {
    expect(sourceCoverChange({ sourceUrl: link }, undefined)).toBe('keep')
  })
})

describe('request tags', () => {
  it('tags a request by its number', () => {
    expect(requestTag(142)).toBe('SQ-142')
  })

  it('puts the tag before the file name', () => {
    expect(taggedFileName(142, 'Plasma.3mf')).toBe('SQ-142 Plasma.3mf')
  })

  it('keeps a file name that already carries its tag', () => {
    expect(taggedFileName(142, 'SQ-142 Plasma.3mf')).toBe('SQ-142 Plasma.3mf')
  })
})

describe('taggedRequestNumber', () => {
  it('finds the tag a downloaded file carries', () => {
    expect(taggedRequestNumber('SQ-142 Plasma')).toBe(142)
  })

  it('finds a tag after underscores became spaces', () => {
    expect(taggedRequestNumber('Plate 1 SQ-7 Hull')).toBe(7)
  })

  it('ignores a tag inside another word', () => {
    expect(taggedRequestNumber('XSQ-7')).toBeUndefined()
  })

  it('takes no tag when the name has two', () => {
    expect(taggedRequestNumber('SQ-7 SQ-8 plate')).toBeUndefined()
  })
})
