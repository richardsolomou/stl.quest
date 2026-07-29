import { describe, expect, it } from 'vitest'
import type { UploadEntry } from './uploadTypes'
import { uploadErrorMessage, uploadFingerprint, uploadMetadata } from './uploadTransport'

const entry = {
  key: 'entry',
  file: new File(['model'], 'model.stl', { type: 'model/stl', lastModified: 123 }),
  name: ' Model ',
  quantity: '2.6',
  notes: ' note ',
  sourceUrl: ' https://example.com/model ',
  printType: 'resin',
  noteOpen: true,
  linkOpen: true,
  state: 'pending',
} satisfies UploadEntry

describe('upload metadata', () => {
  it('normalizes request fields for the upload protocol', () => {
    expect(uploadMetadata(entry)).toEqual({
      filename: 'model.stl',
      name: 'Model',
      quantity: '3',
      notes: 'note',
      sourceUrl: 'https://example.com/model',
      requestedPrintType: 'resin',
    })
  })

  it('omits empty optional fields', () => {
    expect(uploadMetadata({ ...entry, notes: ' ', sourceUrl: ' ' })).toEqual({
      filename: 'model.stl',
      name: 'Model',
      quantity: '3',
      requestedPrintType: 'resin',
    })
  })

  it('includes file and request identity in the resume fingerprint', () => {
    expect(uploadFingerprint('workspace', entry)).toBe(
      'stlquest-workspace-model.stl-model/stl-5-123- Model -2.6- note - https://example.com/model -resin',
    )
  })
})

describe('uploadErrorMessage', () => {
  it('explains that a storage migration temporarily paused uploads', () => {
    const error = Object.assign(new Error('tus protocol detail'), {
      originalResponse: {
        getStatus: () => 423,
        getBody: () => JSON.stringify({ error: 'storage migration is in progress — uploads are temporarily paused' }),
      },
    })

    expect(uploadErrorMessage(error)).toBe('Uploads are paused while storage is moving. Wait for the migration to finish.')
  })

  it('keeps unexpected upload errors available for diagnosis', () => {
    expect(uploadErrorMessage(new Error('Connection lost'))).toBe('Connection lost')
  })
})
